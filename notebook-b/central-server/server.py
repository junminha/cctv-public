from app import create_app
from config import load_settings


def application():
    return create_app(load_settings())
