import httpx
from pydantic import ValidationError

from models import AgentHealth, CameraList, ExportMetadata, RecordingList, utc


class AdapterError(Exception):
    def __init__(self, status, message):
        self.status = status
        self.message = message


class Adapter:
    def __init__(self, settings, http):
        self.url = settings.adapter_url.rstrip('/')
        self.token = settings.adapter_token
        self.http = http

    def get(self, path, schema, params=None):
        return self.request('GET', path, schema, params=params)

    def request(self, method, path, schema, params=None, payload=None):
        if not self.url or not self.token:
            raise AdapterError(503, 'A Adapter is not configured')
        try:
            response = self.http.request(method, self.url + path, params=params, json=payload,
                                         headers={'Authorization': 'Bearer ' + self.token},
                                         timeout=120 if method == 'POST' else 10)
        except httpx.RequestError:
            raise AdapterError(503, 'A Adapter is unreachable') from None
        if response.status_code == 429:
            raise AdapterError(429, 'A export is busy; retry later')
        expected = 201 if method == 'POST' else 200
        if response.status_code != expected:
            # Never relay raw upstream diagnostics or credentials to callers.
            raise AdapterError(503, 'A Adapter request failed')
        try:
            return schema.model_validate(response.json())
        except (ValidationError, ValueError):
            raise AdapterError(502, 'A Adapter returned an invalid response') from None

    def cameras(self):
        return self.get('/agent/v1/cameras', CameraList).cameras

    def health(self):
        return self.get('/agent/v1/health', AgentHealth).model_dump(mode='json')

    def recordings(self, camera_id, start, end):
        result = self.get('/agent/v1/recordings', RecordingList,
                          {'camera_id': camera_id, 'start': start, 'end': end})
        if result.camera_id != camera_id:
            raise AdapterError(502, 'A Adapter returned a different camera')
        return result.model_dump(mode='json')

    def export(self, request):
        metadata = self.request('POST', '/agent/v1/recordings/export', ExportMetadata,
                                payload={'camera_id': request.camera_id, 'start': utc(request.start),
                                         'duration': request.duration})
        if (metadata.camera_id != request.camera_id or metadata.start != request.start
                or abs(metadata.requested_duration - request.duration) > 0.000001
                or metadata.download_path != '/agent/v1/exports/' + metadata.export_id):
            raise AdapterError(502, 'A export metadata does not match the requested clip')
        return metadata
