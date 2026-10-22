import httpx
from pydantic import ValidationError

from models import CameraList, RecordingList


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
        if not self.url or not self.token:
            raise AdapterError(503, 'A Adapter is not configured')
        try:
            response = self.http.get(self.url + path, params=params,
                                     headers={'Authorization': 'Bearer ' + self.token})
        except httpx.RequestError:
            raise AdapterError(503, 'A Adapter is unreachable') from None
        if response.status_code != 200:
            # Never relay raw upstream diagnostics or credentials to callers.
            raise AdapterError(503, 'A Adapter request failed')
        try:
            return schema.model_validate(response.json())
        except (ValidationError, ValueError):
            raise AdapterError(502, 'A Adapter returned an invalid response') from None

    def cameras(self):
        return self.get('/agent/v1/cameras', CameraList).cameras

    def recordings(self, camera_id, start, end):
        result = self.get('/agent/v1/recordings', RecordingList,
                          {'camera_id': camera_id, 'start': start, 'end': end})
        if result.camera_id != camera_id:
            raise AdapterError(502, 'A Adapter returned a different camera')
        return result.model_dump(mode='json')
