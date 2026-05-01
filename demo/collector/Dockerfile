# Tiny image that bakes the collector config in, since Railway doesn't have
# the same "mount a host file at /etc" path that docker-compose does. The
# config still references neat-core via an internal hostname; on Railway that
# resolves through the private-network DNS once the service is wired up.
FROM otel/opentelemetry-collector-contrib:0.96.0

COPY config.yaml /etc/otel-collector-config.yaml

EXPOSE 4318

CMD ["--config=/etc/otel-collector-config.yaml"]
