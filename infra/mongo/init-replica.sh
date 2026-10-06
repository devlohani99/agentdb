#!/bin/sh
set -e

URI="mongodb://relay:relay@mongodb:27017/admin"
until mongosh "$URI" --eval "db.adminCommand('ping')" >/dev/null 2>&1; do
  sleep 1
done

mongosh "$URI" <<'EOF'
try {
  rs.status();
} catch (e) {
  rs.initiate({
    _id: "rs0",
    members: [{ _id: 0, host: "mongodb:27017" }]
  });
}
EOF
