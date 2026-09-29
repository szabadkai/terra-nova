#!/bin/sh
# A home router: the LAN side masquerades out of the WAN side. NAT=cone keeps one outside port per inside
# port (Linux's port preservation: an endpoint-independent mapping, as most home routers), NAT=symmetric picks
# a fresh port for every destination (--random-fully), which STUN cannot see through. NETEM adds delay and
# loss on both sides ("delay 40ms 10ms loss 1%"). TRACE=1 prints the UDP packets on the WAN side and the NAT table.
set -e
WAN=$(ip -o -4 addr show | awk '/172\.30\./{print $2}')
LAN=$(ip -o -4 addr show | awk '/172\.31\./{print $2}')
echo "router: LAN $LAN -> WAN $WAN, NAT $NAT, netem '${NETEM}'"
if [ "$NAT" = symmetric ]; then iptables -t nat -A POSTROUTING -o "$WAN" -j MASQUERADE --random-fully; else iptables -t nat -A POSTROUTING -o "$WAN" -j MASQUERADE; fi
# a home router's own firewall: nothing unasked-for from the outside reaches the router itself. Without this, a
# stray inbound packet is delivered locally and confirms a conntrack entry that then stops the LAN side's own
# outgoing flow from keeping its port - which is exactly what foils hole punching on a lax Linux box
iptables -A INPUT -i "$WAN" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
iptables -A INPUT -i "$WAN" -j DROP
iptables -A FORWARD -i "$LAN" -o "$WAN" -j ACCEPT
iptables -A FORWARD -i "$WAN" -o "$LAN" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
iptables -A FORWARD -i "$WAN" -o "$LAN" -j DROP
if [ -n "$NETEM" ]; then tc qdisc add dev "$LAN" root netem $NETEM; tc qdisc add dev "$WAN" root netem $NETEM; fi
if [ "$TRACE" = 1 ]; then
  apk add -q --no-cache tcpdump conntrack-tools >/dev/null 2>&1 || true
  (tcpdump -lni "$WAN" udp and not port 53 and not port 3478 and not port 443 2>/dev/null | sed 's/^/pkt wan /' | head -100) &
  (tcpdump -lni "$LAN" udp and not port 53 and not port 3478 and not port 443 2>/dev/null | sed 's/^/pkt lan /' | head -100) &
  (while sleep 20; do echo "--- nat table $(date +%T)"; conntrack -L -p udp 2>/dev/null | grep -v "dport=53 " | head -40; done) &
fi
exec sleep infinity
