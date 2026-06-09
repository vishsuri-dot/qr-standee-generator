# WeTravel QR Standee Generator — static site served by nginx
#
# Build: docker build -t qr-standee .
# Run:   docker run --rm -p 8080:80 qr-standee
# Visit: http://localhost:8080

FROM nginx:1.27-alpine

# Strip the default nginx welcome page
RUN rm -rf /usr/share/nginx/html/*

# Drop the static site in place
COPY index.html              /usr/share/nginx/html/
COPY app.js                  /usr/share/nginx/html/
COPY assets/                 /usr/share/nginx/html/assets/
COPY fonts/                  /usr/share/nginx/html/fonts/

# Custom nginx config — long-cache headers for fonts + assets, gzip for everything else
COPY nginx.conf              /etc/nginx/conf.d/default.conf

EXPOSE 80

# Built-in healthcheck — confirms the page is served
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost/index.html >/dev/null || exit 1
