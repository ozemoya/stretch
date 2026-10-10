source ../.venv/bin/activate
../.venv/bin/python ../.venv/bin/pip install -r requirements.txt
../.venv/bin/python ../.venv/bin/pip install uv
../.venv/bin/python ../.venv/bin/pip install "fastapi[standard]"
uv run fastapi dev