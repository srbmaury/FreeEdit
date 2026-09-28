# --- Stage 1: build the DeepFilterLib wheel (no prebuilt Linux wheel for py3.12; needs Rust)
FROM python:3.12-slim AS builder
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
ENV PATH="/root/.cargo/bin:${PATH}"
RUN pip wheel --no-cache-dir --no-deps -w /wheels deepfilterlib==0.5.6

# --- Stage 2: runtime
FROM python:3.12-slim

# git: DeepFilterNet shells out to it at startup to log its version

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg git \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# CPU-only torch wheels (the default Linux wheels pull in ~2 GB of CUDA)
RUN pip install --no-cache-dir torch==2.5.1 torchaudio==2.5.1 \
      --index-url https://download.pytorch.org/whl/cpu
COPY --from=builder /wheels /wheels
COPY requirements.txt .
RUN pip install --no-cache-dir --find-links /wheels -r requirements.txt && rm -rf /wheels

# Bake the DeepFilterNet3 model into the image so cold starts don't download it
RUN python -c "from df.enhance import init_df; init_df(log_level='ERROR')"

COPY backend backend
COPY frontend frontend

# Tuned for small hosts (Render free: 512 MB, shared CPU); see README
ENV PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=1 \
    DF_CHUNK_SECONDS=3 \
    FFMPEG_THREADS=1
EXPOSE 10000
CMD ["sh", "-c", "uvicorn backend.app:app --host 0.0.0.0 --port ${PORT:-10000}"]
