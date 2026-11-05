# Railway cron service «db-backup»: runs db-backup.sh once a day and exits (docs/BACKUPS.md). It reaches Postgres
# over Railway's private network, so the database needs no public address.
# The client must be at least as new as the server (Postgres 18 on Railway); a newer image dumps every older server.
FROM postgres:18

RUN apt-get update -qq \
  && apt-get install -y -qq --no-install-recommends awscli gnupg curl ca-certificates >/dev/null \
  && rm -rf /var/lib/apt/lists/*

COPY db-backup.sh /usr/local/bin/db-backup.sh

ENTRYPOINT ["bash", "/usr/local/bin/db-backup.sh"]
