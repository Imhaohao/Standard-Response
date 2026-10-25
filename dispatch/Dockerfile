# OR-Tools solver service. Runs on any container host (DigitalOcean App Platform, Vultr, Fly.io).
#   docker build -t rollcall-solver dispatch && docker run -p 8799:8799 -e SOLVER_TOKEN=... rollcall-solver
FROM python:3.12-slim
WORKDIR /app
# The service needs only OR-Tools; the version matches uv.lock.
RUN pip install --no-cache-dir ortools==9.15.6755
COPY solver.py fatality.py heuristic.py alns.py server.py ./
ENV SOLVER_HOST=0.0.0.0 PORT=8799
EXPOSE 8799
CMD ["python", "server.py"]
