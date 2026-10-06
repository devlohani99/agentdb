FROM mongo:7

COPY keyfile /etc/mongo-keyfile
RUN chown mongodb:mongodb /etc/mongo-keyfile && chmod 400 /etc/mongo-keyfile

ENTRYPOINT ["docker-entrypoint.sh"]