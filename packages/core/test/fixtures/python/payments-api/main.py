import psycopg2
import requests


def fetch_orders():
    return requests.get("http://orders-api:8000/orders").json()


def connect():
    return psycopg2.connect(
        host="payments-db",
        port=5432,
        database="payments",
    )
