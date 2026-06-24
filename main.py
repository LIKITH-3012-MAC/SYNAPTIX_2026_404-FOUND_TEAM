import sys
import os

# Add backend directory to path so absolute imports within backend can be resolved
backend_dir = os.path.join(os.path.dirname(__file__), 'backend')
sys.path.insert(0, backend_dir)

from app import app
