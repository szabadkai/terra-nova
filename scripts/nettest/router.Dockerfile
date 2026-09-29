FROM alpine:3.20
RUN apk add --no-cache iptables iproute2
COPY router.sh /router.sh
CMD ["sh", "/router.sh"]
