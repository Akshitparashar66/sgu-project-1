"""Official alerts from NDMA's SACHET portal, the system behind India's
public CAP warnings (IMD, state disaster authorities, CWC).

The national RSS feed lists the latest ~100 alerts; each links to a CAP
(Common Alerting Protocol 1.2) file with severity, expiry, area and the text
in English and often Hindi. Only items from issuers that cover Ghaziabad are
opened, each once."""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from collections.abc import Callable
from datetime import datetime, timezone

from app.services.river import gauges, record_river_reading

_CAP = {"c": "urn:oasis:names:tc:emergency:cap:1.2"}
_SEVERITY = {"minor": "info", "moderate": "warning", "severe": "severe", "extreme": "extreme"}
CWC_SOURCE = "CWC via NDMA"


def _utc(text: str | None) -> datetime | None:
    return datetime.fromisoformat(text.strip()).astimezone(timezone.utc) if text and text.strip() else None


def _iso(at: datetime | None) -> str | None:
    return at.isoformat(timespec="seconds") if at else None


def parse_feed(xml: bytes) -> list[dict]:
    items = []
    for item in ET.fromstring(xml).iterfind("./channel/item"):
        author = item.findtext("author") or ""
        issuer = re.search(r"\(([^)]*)\)", author)
        items.append({"guid": (item.findtext("guid") or "").strip(), "title": item.findtext("title") or "",
                      "link": (item.findtext("link") or "").strip(), "issuer": issuer.group(1) if issuer else author,
                      "published": item.findtext("pubDate")})
    return items


def watched_issuer(item: dict, cfg: dict) -> bool:
    return item["issuer"].lower() in {i.lower() for i in cfg["issuers"]}


def parse_cap(xml: bytes) -> dict:
    root = ET.fromstring(xml)

    def text(node, tag: str) -> str:
        return (node.findtext(f"c:{tag}", namespaces=_CAP) or "").strip()

    return {
        "identifier": text(root, "identifier"), "sender": text(root, "sender"), "sent": _utc(text(root, "sent")),
        "msgType": text(root, "msgType"),
        "infos": [{
            "language": text(info, "language"), "event": text(info, "event"), "severity": text(info, "severity"),
            "urgency": text(info, "urgency"), "certainty": text(info, "certainty"), "expires": _utc(text(info, "expires")),
            "headline": text(info, "headline"), "description": text(info, "description"),
            "instruction": text(info, "instruction"),
            "areas": [text(area, "areaDesc") for area in info.iterfind("c:area", _CAP)],
        } for info in root.iterfind("c:info", _CAP)],
    }


def _info(cap: dict, language: str) -> dict | None:
    return next((i for i in cap["infos"] if i["language"].lower().startswith(language)), None)


def _first_place(text: str, places: list[str]) -> str | None:
    return next((p for p in places if re.search(rf"\b{re.escape(p)}\b", text)), None)


def alert_from_cap(cap: dict, item: dict, cfg: dict) -> dict | None:
    """An alert if the CAP text names a watched place (keeping its own
    severity), an information-only one for a nearby place, else None."""
    if cap["msgType"].lower() == "cancel" or not cap["infos"]:
        return None
    en = _info(cap, "en") or cap["infos"][0]
    hi = _info(cap, "hi")
    text = " ".join([en["headline"], en["description"], *en["areas"]]).lower()
    watched = _first_place(text, cfg["watchedPlaces"])
    nearby = None if watched else _first_place(text, cfg["nearbyPlaces"])
    if not watched and not nearby:
        return None
    headline = en["headline"] or en["event"]
    return {
        "id": f"ndma:{item['guid']}", "source": "ndma", "isDemo": False,
        "severity": _SEVERITY.get(en["severity"].lower(), "info") if watched else "info",
        "title": headline if watched else f"Nearby ({nearby.title()}): {headline}",
        "titleHi": (hi["headline"] if hi else None) or None,
        "detail": " ".join(filter(None, [en["description"] if en["description"] != headline else "", en["instruction"],
                                         f"Issued by {cap['sender']} ({item['issuer']}).", f"Event: {en['event']}."])),
        "area": ", ".join(en["areas"]),
        "observedAt": _iso(cap["sent"]), "expiresAt": _iso(en["expires"]),
        "link": item["link"], "edgeIds": [],
        "action": {"label": "Open the flood scenario", "scenarioId": cfg["scenarioId"]} if watched else None,
    }


def river_reading_from_cap(cap: dict, gauge_list: list[dict]) -> dict | None:
    """CWC flood alerts state the level in plain text: "flowing at a level of
    61.37 m … Warning Level of 61.22 m … Danger Level of 62.22 m"."""
    if "cwc" not in cap["sender"].lower() or not cap["infos"]:
        return None
    en = _info(cap, "en") or cap["infos"][0]
    text = f"{en['headline']} {en['description']}"
    level = re.search(r"level of ([\d.]+) ?m\b", text)
    for gauge in gauge_list:
        if level and re.search(rf"\briver {re.escape(gauge['river'])}\b", text, re.IGNORECASE):
            warning = re.search(r"Warning Level of ([\d.]+)", text, re.IGNORECASE)
            danger = re.search(r"Danger Level of ([\d.]+)", text, re.IGNORECASE)
            return {"gaugeId": gauge["id"], "levelM": float(level.group(1)), "observedAt": cap["sent"],
                    "cwcWarningLevelM": float(warning.group(1)) if warning else None,
                    "cwcDangerLevelM": float(danger.group(1)) if danger else None}
    return None


def poll(cfg: dict, cache: dict, fetch: Callable[[str], bytes]) -> list[dict]:
    """Current alerts for the watched area. `cache` (guid → alert or None)
    persists between polls, so each CAP file is fetched once; a CAP file that
    fails to load is simply tried again next time."""
    watched = [i for i in parse_feed(fetch(cfg["feedUrl"])) if watched_issuer(i, cfg) and i["guid"]]
    gauge_list = gauges()
    for item in watched:
        if item["guid"] in cache:
            continue
        try:
            cap = parse_cap(fetch(item["link"]))
        except Exception:  # one bad file must not hide the others
            continue
        cache[item["guid"]] = alert_from_cap(cap, item, cfg)
        reading = river_reading_from_cap(cap, gauge_list)
        if reading:
            record_river_reading(gauge_id=reading["gaugeId"], level_m=reading["levelM"],
                                 observed_at=reading["observedAt"], source=CWC_SOURCE)
    current = {i["guid"] for i in watched}
    for guid in [g for g in cache if g not in current]:
        del cache[guid]
    return [cache[i["guid"]] for i in watched if cache.get(i["guid"])]
