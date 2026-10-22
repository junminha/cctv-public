"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { Circle, CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import type { LatLngExpression, Map as LeafletMap } from "leaflet";
import { api, type AnalysisCamera, type Camera, type ReportSummary } from "@/lib/api";

const BUSAN: LatLngExpression = [35.1336, 129.103]; // PKNU Daeyeon campus, exhibition venue
const PUBLIC_MIN_ZOOM = 14;
// Canvas rendering cannot resolve CSS variables, so mirror the globals.css tokens here.
const COLORS = { beacon: "#e2580b", tide: "#0d7f81", buoy: "#8a9ba8", ink: "#0f2a3d", "ink-soft": "#4b6271" } as const;
const css = (name: keyof typeof COLORS) => COLORS[name];

type PublicCamera = { id: string; name: string; district: string; purpose: string; latitude: number; longitude: number };

export type MapProps = {
  reports: ReportSummary[];
  cameras: Camera[];
  selected: ReportSummary | null;
  ranking: AnalysisCamera[];
  draft: [number, number] | null;
  picking: boolean;
  showPublic: boolean;
  focus?: [number, number] | null;
  onPick: (point: [number, number]) => void;
  onSelect: (reportId: string) => void;
  onPublicCount?: (count: { shown: number; total: number } | null) => void;
};

function Clicks({ picking, onPick }: { picking: boolean; onPick: MapProps["onPick"] }) {
  useMapEvents({
    click(event) {
      if (picking) onPick([event.latlng.lat, event.latlng.lng]);
    },
  });
  return null;
}

function Fly({ target }: { target?: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo(target, Math.max(map.getZoom(), 18), { duration: 0.6 });
  }, [map, target]);
  return null;
}

function PublicLayer({ enabled, onCount }: { enabled: boolean; onCount?: MapProps["onPublicCount"] }) {
  const map = useMap();
  const [points, setPoints] = useState<PublicCamera[]>([]);
  const request = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const load = async () => {
      if (map.getZoom() < PUBLIC_MIN_ZOOM) {
        setPoints([]);
        onCount?.({ shown: 0, total: -1 });
        return;
      }
      const bounds = map.getBounds();
      const id = ++request.current;
      const query = new URLSearchParams({
        west: String(bounds.getWest()), south: String(bounds.getSouth()),
        east: String(bounds.getEast()), north: String(bounds.getNorth()), limit: "1000",
      });
      const data = await api<{ cameras: PublicCamera[]; total: number }>(`/api/v1/admin/public-cameras?${query}`).catch(() => null);
      if (data && id === request.current) {
        setPoints(data.cameras);
        onCount?.({ shown: data.cameras.length, total: data.total });
      }
    };
    load();
    map.on("moveend", load);
    return () => {
      map.off("moveend", load);
    };
  }, [enabled, map, onCount]);

  return (
    <>
      {enabled && points.map((point) => (
        <CircleMarker
          key={point.id}
          center={[point.latitude, point.longitude]}
          radius={3}
          pathOptions={{ color: css("buoy"), weight: 1, fillColor: css("buoy"), fillOpacity: 0.55 }}
        >
          <Tooltip>{`${point.name} · ${point.purpose} (공개 위치 · 영상 분석 대상 아님)`}</Tooltip>
        </CircleMarker>
      ))}
    </>
  );
}

export default function ChartMap(props: MapProps) {
  const mapRef = useRef<LeafletMap | null>(null);
  const { selected, ranking, cameras } = props;
  const running = selected?.job.state === "running" || selected?.job.state === "queued";
  const placed = cameras.filter((camera) => camera.latitude !== null && camera.longitude !== null);
  const ranks = new Map(ranking.map((row) => [row.camera_id, row]));

  return (
    <MapContainer
      ref={mapRef}
      center={BUSAN}
      zoom={17}
      preferCanvas
      className={`h-full w-full ${props.picking ? "cursor-crosshair" : ""}`}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      <Clicks picking={props.picking} onPick={props.onPick} />
      <Fly target={props.focus} />
      <PublicLayer enabled={props.showPublic} onCount={props.onPublicCount} />

      {selected && (
        <>
          <Circle
            center={[selected.latitude, selected.longitude]}
            radius={selected.radius_m}
            pathOptions={{ color: css("beacon"), weight: 1.5, dashArray: "6 6", fillColor: css("beacon"), fillOpacity: 0.06,
              className: running ? "radar-sweep" : undefined }}
          />
          {placed.map((camera) => {
            const row = ranks.get(camera.id);
            if (!row) return null;
            const chosen = selected.selected_camera_ids.includes(camera.id);
            return (
              <Polyline
                key={`link-${camera.id}`}
                positions={[[selected.latitude, selected.longitude], [camera.latitude!, camera.longitude!]]}
                pathOptions={{ color: chosen ? css("beacon") : css("ink-soft"), weight: chosen ? 3 : 1, dashArray: chosen ? undefined : "3 5" }}
              />
            );
          })}
        </>
      )}

      {placed.map((camera) => {
        const chosen = selected?.selected_camera_ids.includes(camera.id) ?? false;
        const usable = camera.approved && camera.demo_source;
        const color = usable ? css("tide") : css("buoy");
        const score = ranks.get(camera.id)?.rank_score;
        return (
          <CircleMarker
            key={`${camera.id}-${score ?? "none"}-${chosen}`}
            center={[camera.latitude!, camera.longitude!]}
            radius={chosen ? 11 : 8}
            pathOptions={{ color: chosen ? css("beacon") : color, weight: chosen ? 4 : 2, fillColor: color,
              fillOpacity: camera.online ? 0.85 : 0.25 }}
          >
            {score !== undefined ? (
              <Tooltip permanent direction="right" offset={[10, 0]} className="score-tag">{`${camera.id} ${score.toFixed(2)}`}</Tooltip>
            ) : (
              <Tooltip direction="top" offset={[0, -8]}>
                {`${camera.id}${camera.zone ? ` · ${camera.zone}` : ""}${usable ? "" : " · 분석 미승인"}${camera.online ? "" : " · 오프라인"}`}
              </Tooltip>
            )}
          </CircleMarker>
        );
      })}

      {props.reports.map((report) => {
        const active = report.report_id === selected?.report_id;
        return (
          <CircleMarker
            key={report.report_id}
            center={[report.latitude, report.longitude]}
            radius={active ? 9 : 6}
            eventHandlers={{ click: () => props.onSelect(report.report_id) }}
            pathOptions={{ color: "#fff", weight: 2, fillColor: css("beacon"), fillOpacity: active ? 1 : 0.7,
              className: active && running ? "beacon-pulse" : undefined }}
          />
        );
      })}

      {props.draft && (
        <CircleMarker center={props.draft} radius={9}
          pathOptions={{ color: css("beacon"), weight: 3, dashArray: "2 3", fillColor: "#fff", fillOpacity: 1 }}>
          <Tooltip permanent direction="top" offset={[0, -10]}>신고 지점</Tooltip>
        </CircleMarker>
      )}
    </MapContainer>
  );
}
