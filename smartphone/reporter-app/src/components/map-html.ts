import { color } from '@/theme';

type Options = { latitude: number; longitude: number; radiusM: number; editable: boolean; shiftY: number };

// Leaflet page shared by the native WebView and the web iframe. Standard OpenStreetMap tiles
// (as the admin console) inverted into a night chart; the search radius is in real metres.
export function mapHtml({ latitude, longitude, radiusM, editable, shiftY }: Options) {
  const zoom = editable ? 16 : 14;
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
html,body,#map{margin:0;height:100%;background:${color.night}}
.leaflet-container{background:${color.night};font-family:sans-serif}
.leaflet-tile-pane{filter:invert(1) hue-rotate(185deg) brightness(.78) contrast(.95) saturate(.55)}
.leaflet-control-attribution{font-size:9px;background:rgba(14,36,51,.7)!important;color:${color.onNightSoft}}
.leaflet-control-attribution a{color:${color.onNightSoft}}
.pin{position:absolute;left:50%;top:50%;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;
background:${color.beacon};border:3px solid #fff;box-shadow:0 0 0 10px rgba(196,71,10,.3);z-index:500;pointer-events:none}
.tag{display:inline-block;transform:translate(-50%,-50%);white-space:nowrap;padding:3px 10px;border-radius:10px;
border:1px solid ${color.beacon};background:${color.night};color:${color.beacon};font:500 12px/16px sans-serif}
</style></head><body><div id="map"></div>${editable ? '<div class="pin"></div>' : ''}
<script>
var beacon='${color.beacon}',radius=${radiusM},shiftY=${shiftY};
var map=L.map('map',{zoomControl:false,attributionControl:true,dragging:${editable},touchZoom:${editable},
  scrollWheelZoom:${editable},doubleClickZoom:${editable},boxZoom:false,keyboard:false});
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(map);
var area=L.circle([0,0],{radius:radius,color:beacon,weight:1.5,dashArray:'6 6',fillColor:beacon,fillOpacity:.07}).addTo(map);
var ring=L.circleMarker([0,0],{radius:26,color:beacon,weight:1.5,opacity:.7,fill:false,interactive:false}).addTo(map);
var dot=${editable ? 'null' : "L.circleMarker([0,0],{radius:8,color:'#fff',weight:3,fillColor:beacon,fillOpacity:1}).addTo(map)"};
var tag=L.marker([0,0],{interactive:false,icon:L.divIcon({className:'',iconSize:null,
  html:'<span class="tag">반경 '+radius+'m 안 CCTV 탐색</span>'})}).addTo(map);
function place(ll){area.setLatLng(ll);ring.setLatLng(ll);if(dot){dot.setLatLng(ll)}
  tag.setLatLng([ll.lat-radius/111320,ll.lng])}
function send(msg){var s=JSON.stringify(msg);if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(s)}else{window.parent.postMessage(s,'*')}}
window.setCenter=function(lat,lng){map.setView([lat,lng],map.getZoom()||${zoom},{animate:false});
  if(shiftY){map.panBy([0,shiftY],{animate:false})}place(L.latLng(lat,lng))};
window.addEventListener('message',function(e){try{var m=JSON.parse(e.data);if(m.type==='center'){window.setCenter(m.latitude,m.longitude)}}catch(_){}});
map.setView([${latitude},${longitude}],${zoom});window.setCenter(${latitude},${longitude});
${editable ? "map.on('move',function(){place(map.getCenter())});map.on('moveend',function(){var c=map.getCenter();send({type:'moved',latitude:c.lat,longitude:c.lng})});" : ''}
</script></body></html>`;
}
