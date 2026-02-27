"""
RESOLVIT - Database Configurinitializedes PostgreSQL connection pool via psycopg2
"""

import os
import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2 import pool
from contextlib import contextmanager
from dotenv import load_dotenv

load_dotenv()

# Use environment variable if available, otherwise fallback to Aiven DB
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgres://avnadmin:AVNS_MMwB9rgxixn296jxJQt@pg-14c610e1-resolvit-app.j.aivencloud.com:24625/defaultdb?sslmode=require"
)

_pool = None


def init_pool():
    global _pool
    if _pool is None:
        _pool = pool.ThreadedConnectionPool(
            minconn=2,
            maxconn=20,
            dsn=DATABASE_URL,
            cursor_factory=RealDictCursor
        )
    return _pool


@contextmanager
def get_db():
    """Context manager that yields a database cursor and handles commit/rollback."""
    connection_pool = init_pool()
    conn = connection_pool.getconn()

    try:
        conn.autocommit = False
        cursor = conn.cursor()
        yield cursor
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cursor.close()
        connection_pool.putconn(conn)


def execute_schema():
    """Initialize the database schema on startup."""
    schema_path = os.path.join(
        os.path.dirname(__file__),
        '..',
        'database',
        'schema.sql'
    )

    if os.path.exists(schema_path):
        with get_db() as cursor:
            with open(schema_path, 'r') as f:
                cursor.execute(f.read())
        print("[DB] Schema initialized successfully.”)
