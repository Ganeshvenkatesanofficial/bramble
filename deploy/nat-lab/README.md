# Test hole punching behind two NATs

Use this guide to put two Bramble nodes behind two different NATs and to force the relay fallback. It serves W8 and demo beat 4. All steps need root. None has run yet: the development machine has no user namespaces and no `sudo`, so every step is **Open** unless marked otherwise.

Labels: Verified, Read from source, Open (see `../README.md`).

## Choose a setup

| Setup                | Where                           | Use it for                                                 |
| -------------------- | ------------------------------- | ---------------------------------------------------------- |
| `netns-lab.sh`       | One Linux machine with root     | Developing W8 without cloud machines. Six namespaces.      |
| `scripts/nat-box.sh` | The gateway and worker machines | The real demo topology. Each node sits behind its own NAT. |

Both use Linux nftables source NAT. `cone` uses `masquerade`, which keeps the source port when it is free. `symmetric` uses `masquerade random`, which picks a new source port per flow. Why these two: `../TOPOLOGY.md`.

## Local lab

Needs `iproute2` and `nftables`.

1. Build the lab: `sudo deploy/nat-lab/netns-lab.sh up cone`. Open.
2. Check it: `sudo deploy/nat-lab/netns-lab.sh status`. Open.
3. Run the relay and STUN server in the `server` namespace (address `192.0.2.10`) and one `brambled` in each of `nodeA` and `nodeB`, with `ip netns exec <ns> ...`. Give each node its own state directory and key. Open.
4. Repeat from step 1 with `symmetric` to see the relay fallback. Open.
5. Remove everything: `sudo deploy/nat-lab/netns-lab.sh down`. Open.

## Cloud NAT box

Run on both the gateway and the worker machine. The node then reaches the internet through source NAT on its own host.

1. Create the box: `sudo deploy/scripts/nat-box.sh up cone`. Open.
2. Move the node unit into it: copy `deploy/systemd/nat-box.conf.example` to `/etc/systemd/system/bramble-gateway.service.d/nat-box.conf` (or `bramble-worker.service.d`), then `sudo systemctl daemon-reload && sudo systemctl restart bramble-gateway`. Open.
3. Confirm that the node's traffic leaves with the host's address: `sudo ip netns exec bramble-node curl -sS https://ifconfig.me`. Open.
4. Enable it at boot: `sudo systemctl enable --now bramble-nat-box`. Open.

Inbound packets reach the node only through a mapping the node created first, so the peer must use the address that STUN reports, not the host's address with port 51820. Read from source (nftables semantics).

## Check the NAT type

Query two STUN servers from inside the box. Two different mapped ports mean the NAT is symmetric.

```sh
sudo ip netns exec bramble-node turnutils_stunclient -p 3478 <relays-machine-public-name>
sudo ip netns exec bramble-node turnutils_stunclient -p 3478 <second-stun-server>
```

`turnutils_stunclient` ships with the `coturn` package. A second STUN server must come from a human or from a second relays-machine address; pick one and record it. Open.

## Force the relay fallback

Beat 4 needs the direct path blocked on demand.

1. Block direct UDP to the peer: `sudo deploy/scripts/nat-box.sh block-direct <peer-public-ip>`. This drops forwarded UDP to that address, so the relay (a different address) still works. Open.
2. Watch the node's status API (`http://127.0.0.1:7899`) switch the path from direct to relay. The status field names are Read from the W8 branch (ETH-36), unmerged. Open.
3. Restore: `sudo deploy/scripts/nat-box.sh unblock-direct`. Open.

The ruleset can be printed without root: `deploy/scripts/nat-box.sh print-rules symmetric <peer-ip>`. Verified on 6 Nov 2026 that it prints; `nft -c` could not fully check it here (netlink permission denied), so syntax is parse-checked only.

## Remove the box

`sudo deploy/scripts/nat-box.sh down`. Open.
