# --- Stage 1: build the DeepFilterLib wheel (no prebuilt Linux wheel for py3.12; needs Rust)
FROM python:3.12-slim AS builder
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
ENV PATH="/root/.cargo/bin:${PATH}"
ARG PIP_DEFAULT_TIMEOUT=60
RUN pip wheel --no-cache-dir --no-deps -w /wheels deepfilterlib==0.5.6

# --- Stage 2: runtime
FROM python:3.12-slim
ARG PIP_DEFAULT_TIMEOUT=60

# git: DeepFilterNet shells out to it at startup to log its version

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg git \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# CPU-only torch wheels (the default Linux wheels pull in ~2 GB of CUDA)
RUN pip install --no-cache-dir torch==2.5.1 torchaudio==2.5.1 \
      --index-url https://download.pytorch.org/whl/cpu
COPY --from=builder /wheels /wheels
COPY pyproject.toml ./
RUN pip install --no-cache-dir "pip>=25.1" && \
    pip install --no-cache-dir --find-links /wheels --group web --group noise && rm -rf /wheels

# Optional person segmentation is isolated from the noise-removal environment.
ARG INSTALL_BACKGROUND=false
RUN if [ "$INSTALL_BACKGROUND" = "true" ]; then \
      apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && \
      rm -rf /var/lib/apt/lists/* && \
      python -m venv .venv-background && \
      python -m pip --python .venv-background install --no-cache-dir --group background; fi

# Bake the DeepFilterNet3 model into the image so cold starts don't download it
RUN python -c "from df.enhance import init_df; init_df(log_level='ERROR')"

COPY backend backend
ARG INSTALL_TTS=false
COPY scripts/setup-tts.sh scripts/setup-tts.sh
RUN if [ "$INSTALL_TTS" = "true" ]; then \
      apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && \
      rm -rf /var/lib/apt/lists/* && \
      PYTHON_BIN=/usr/local/bin/python ./scripts/setup-tts.sh; fi
ARG INSTALL_CHATGPT_PLUGIN=false
RUN if [ "$INSTALL_CHATGPT_PLUGIN" = "true" ]; then \
      pip install --no-cache-dir --group web --group chatgpt; fi
COPY frontend frontend
COPY LICENSE LICENSE

# Tuned for small hosts (Render free: 512 MB, shared CPU); see README
ENV PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=1 \
    DF_CHUNK_SECONDS=3 \
    FFMPEG_THREADS=1 \
    MAX_OUTPUT_SIDE=1600 \
    FREEEDIT_TTS_ISOLATED=true \
    FREEEDIT_TTS_LOW_MEMORY=true \
    FREEEDIT_TTS_CHUNK_CHARS=30 \
    FREEEDIT_TTS_TIMEOUT_SECONDS=165
EXPOSE 10000
CMD ["sh", "-c", "uvicorn backend.app:app --no-access-log --host 0.0.0.0 --port ${PORT:-10000}"]
