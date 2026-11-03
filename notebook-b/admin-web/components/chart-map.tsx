"use client";

import "leaflet/dist/leaflet.css";
import { Fragment, useEffect, useRef, useState } from "react";
import { Circle, CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { divIcon, latLng, type LatLngExpression, type Map as LeafletMap } from "leaflet";
import { relevanceLabel } from "@/lib/labels";
import { api, type AnalysisCamera, type Camera, type PublicRecommendation, type ReportSummary } from "@/lib/api";

const BUSAN: LatLngExpression = [35.1336, 129.103]; // PKNU Daeyeon campus, exhibition venue
const PUBLIC_MIN_ZOOM = 14;
// Fit the search circle with a little room around it.
const RADIUS_MARGIN = 1.25;
// Canvas rendering cannot resolve CSS variables, so mirror the globals.css tokens here.
const COLORS = { beacon: "#e2580b", report: "#0f2a3d", tide: "#0d7f81", buoy: "#8a9ba8", signal: "#dc2626", ink: "#0f2a3d", "ink-soft": "#4b6271" } as const;
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
  onPick: (point: [number, number]) => void;
  onSelect: (reportId: string) => void;
  onPublicCount?: (count: { shown: number; total: number } | null) => void;
  recommended?: PublicRecommendation[];
};

const reportPin = (active: boolean, running: boolean, draft = false) =>
  divIcon({
    className: "",
    html: `<span class="report-pin${active ? " active" : ""}${running ? " running" : ""}${draft ? " draft" : ""}"></span>`,
    iconSize: active || draft ? [20, 20] : [14, 14],
    iconAnchor: active || draft ? [10, 10] : [7, 7],
  });

const pin = (rank: number) =>
  divIcon({ className: "", html: `<span class="rec-pin${rank === 1 ? " top" : ""}">${rank}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] });

function Recommended({ rows }: { rows: PublicRecommendation[] }) {
  return (
    <>
      {rows.map((row, index) => (
        <Marker key={row.id} position={[row.latitude, row.longitude]} icon={pin(index + 1)} zIndexOffset={1000 - index}
          title={`추천 ${index + 1}위 ${row.kind === "webcam" ? "시연 웹캠" : "공공 CCTV"} ${row.name}`}>
          <Tooltip direction="top" offset={[0, -12]}>{`${index + 1}위 · ${row.name}`}</Tooltip>
          <Popup>
            <strong>{index + 1}위 · {row.name}</strong>
            <br />{row.kind === "webcam" ? `${row.id} · 시연 웹캠` : `${row.district ?? "구역 미상"} · ${row.purpose} · 장비 ${row.device_count}대`} · {Math.round(row.distance_m)}m
            <br />위도 {row.latitude.toFixed(5)} · 경도 {row.longitude.toFixed(5)}
            <br />장소 단서: {row.place ? `${row.place} (이름으로 추정)` : "없음"} · 적합도 {Math.round(row.score * 100)}%
            {row.reasons.map((reason) => <span key={reason}><br />· {reason}</span>)}
            <br /><em>{row.kind === "webcam" ? "같은 기준의 위치 순위 · 영상 분석 가능" : "위치정보 기준 · 영상 미분석"}</em>
          </Popup>
        </Marker>
      ))}
    </>
  );
}

function Clicks({ picking, onPick }: { picking: boolean; onPick: MapProps["onPick"] }) {
  useMapEvents({
    click(event) {
      if (picking) onPick([event.latlng.lat, event.latlng.lng]);
    },
  });
  return null;
}

function FitRadius({ report }: { report: ReportSummary | null }) {
  const map = useMap();
  const shown = useRef<string | null>(null);
  const id = report?.report_id;
  const lat = report?.latitude;
  const lng = report?.longitude;
  const radius = report?.radius_m;
  useEffect(() => {
    if (id === undefined || lat === undefined || lng === undefined || radius === undefined) {
      shown.current = null;
      return;
    }
    const bounds = latLng(lat, lng).toBounds(radius * 2 * RADIUS_MARGIN);
    const options = { padding: [16, 16] as [number, number], maxZoom: 19 };
    // Glide to a newly selected report; follow radius changes quickly so dragging the slider feels live.
    if (shown.current !== id) map.flyToBounds(bounds, { ...options, duration: 0.6 });
    else map.fitBounds(bounds, { ...options, animate: true, duration: 0.25 });
    shown.current = id;
  }, [map, id, lat, lng, radius]);
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
          radius={5}
          pathOptions={{ stroke: false, fillColor: css("signal"), fillOpacity: 0.9 }}
        >
          <Tooltip>{`${point.name} · ${point.purpose} (공개 위치 · 영상 분석 대상 아님)`}</Tooltip>
        </CircleMarker>
      ))}
    </>
  );
}

// Next keeps visited routes alive in a hidden <Activity>. react-leaflet removes its map when the
// route is hidden and cannot reuse it afterwards, so mount a fresh map each time it becomes visible.
export default function ChartMap(props: MapProps) {
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the effect lifecycle is the visibility signal
    setGeneration((value) => value + 1);
    return () => setGeneration(0);
  }, []);
  return generation ? <LiveMap key={generation} {...props} /> : null;
}

function LiveMap(props: MapProps) {
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
      <FitRadius report={selected} />
      <PublicLayer enabled={props.showPublic} onCount={props.onPublicCount} />

      {selected && (
        <>
          <Circle
            center={[selected.latitude, selected.longitude]}
            radius={selected.radius_m}
            pathOptions={{ color: css("report"), weight: 1.5, dashArray: "6 6", fillColor: css("report"), fillOpacity: 0.06,
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
        const color = usable ? css("signal") : css("buoy");
        const score = ranks.get(camera.id)?.rank_score;
        const radius = chosen ? 9 : 7;
        return (
          <Fragment key={`${camera.id}-${score ?? "none"}-${chosen}`}>
          <CircleMarker center={[camera.latitude!, camera.longitude!]} radius={radius + 2.5} interactive={false}
            pathOptions={{ color: chosen ? css("beacon") : css("ink"), weight: chosen ? 2 : 1, fill: false }} />
          <CircleMarker
            center={[camera.latitude!, camera.longitude!]}
            radius={radius}
            pathOptions={{ color: "#fff", weight: 3, fillColor: color, fillOpacity: camera.online ? 0.95 : 0.35 }}
          >
            {score !== undefined ? (
              <Tooltip permanent direction="right" offset={[10, 0]} className="score-tag">{`${camera.id} 관련 ${relevanceLabel(score)}`}</Tooltip>
            ) : (
              <Tooltip direction="top" offset={[0, -8]}>
                {`${camera.id}${camera.zone ? ` · ${camera.zone}` : ""}${usable ? "" : " · 분석 미승인"}${camera.online ? "" : " · 오프라인"}`}
              </Tooltip>
            )}
          </CircleMarker>
          </Fragment>
        );
      })}

      {props.reports.map((report) => {
        const active = report.report_id === selected?.report_id;
        return (
          <Marker
            key={report.report_id}
            position={[report.latitude, report.longitude]}
            icon={reportPin(active, active && running)}
            zIndexOffset={active ? 900 : 0}
            title={`신고 지점 #${report.report_id.slice(0, 6).toUpperCase()}`}
            eventHandlers={{ click: () => props.onSelect(report.report_id) }}
          />
        );
      })}

      {selected && props.recommended && <Recommended rows={props.recommended} />}

      {props.draft && (
        <Marker position={props.draft} icon={reportPin(false, false, true)}>
          <Tooltip permanent direction="top" offset={[0, -10]}>신고 지점</Tooltip>
        </Marker>
      )}
    </MapContainer>
  );
}
