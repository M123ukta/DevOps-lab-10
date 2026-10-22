FROM node:20-alpine AS test
WORKDIR /src
COPY index.html ./
COPY tests/ ./tests/
RUN node tests/dashboard.test.js

# ---------- Stage 2: runtime ----------
FROM nginx:1.27-alpine

ARG APP_VERSION=dev
# FAULTY=true builds a deliberately broken release (monitoring feed offline, no health
# endpoint) used to demonstrate failed-rollout detection and automatic rollback.
ARG FAULTY=false
LABEL org.opencontainers.image.title="aquagrid-water-dashboard" \
      org.opencontainers.image.description="Smart Water Distribution and Leakage Monitoring Dashboard" \
      org.opencontainers.image.version="${APP_VERSION}"

WORKDIR /usr/share/nginx/html
RUN rm -f ./*.html

# COPY --from=test forces the test stage to run on every build
COPY --from=test /src/index.html ./index.html

# Stamp the version and create the health endpoint used by Docker & Kubernetes probes
RUN sed -i "s/__APP_VERSION__/${APP_VERSION}/g" index.html \
 && printf '{"status":"UP","service":"water-dashboard","version":"%s"}\n' "${APP_VERSION}" > health.json \
 && if [ "${FAULTY}" = "true" ]; then \
      echo ">>> Building DELIBERATELY FAULTY release ${APP_VERSION}"; \
      sed -i 's/__TELEMETRY_FEED__/offline/' index.html; \
      rm -f health.json; \
    else \
      sed -i 's/__TELEMETRY_FEED__/online/' index.html; \
    fi

EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/health.json || exit 1
