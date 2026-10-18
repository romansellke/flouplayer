"""Browser tests: the real page and script, with the API mocked (see conftest.MockApi)."""
import pytest

from tests.conftest import open_app
from tests.devices import PLAYER, SERVER, SERVER2

pytestmark = pytest.mark.ui


def track(i, album="Album One", album_artist="", artist="Artist X"):
    return {"type": "item", "id": f"t{i}", "title": f"Track {i}", "artist": artist, "album": album, "album_artist": album_artist,
            "date": "2001", "track_number": str(i), "class": "object.item.audioItem.musicTrack",
            "resources": [{"uri": f"u{i}", "protocol": "http-get:*:audio/flac:*", "duration": "0:03:00"}], "metadata": "<x/>"}


def browse(tree):
    def answer(req):
        import json
        items = tree.get(json.loads(req.post_data)["object_id"], [])
        return {"items": items, "number_returned": len(items), "total_matches": len(items)}
    return answer


def picker_labels(page):
    return page.evaluate("""[document.querySelector('#server + .picker .picker-btn').textContent.trim(),
                              document.querySelector('#renderer + .picker .picker-btn').textContent.trim()]""")


def pick(page, which, nth):
    page.click(f"#{which} + .picker .picker-btn")
    page.click(f"#{which} + .picker .picker-menu li:nth-child({nth})")


def select_renderer(page):
    page.evaluate("""() => { const s = document.querySelector('#renderer'); s.innerHTML += '<option value="ren1">Linn</option>';
                             s.value = 'ren1'; s.dispatchEvent(new Event('change')) }""")


# ---------- devices ----------

def test_the_chosen_devices_are_remembered_and_shown(page, api):
    api.routes.update({"devices/restore": lambda r: {"devices": restored[0]}, "discover": {"devices": [SERVER, SERVER2, PLAYER]},
                       "browse": browse({"0": [{"type": "container", "id": "a", "title": "Albums"}]})})
    restored = [[]]
    open_app(page)
    page.click("#discover")
    page.wait_for_function("document.querySelectorAll('#server option').length > 1")
    pick(page, "server", 2); pick(page, "renderer", 3)
    assert picker_labels(page) == ["Music Server · MinimServer", "Linn · Majik"]

    page.click("#discover")                                   # searching again must not reset the choice
    page.wait_for_timeout(300)
    assert picker_labels(page) == ["Music Server · MinimServer", "Linn · Majik"]

    pick(page, "server", 3)                                    # ... and another device can be picked
    assert picker_labels(page)[0] == "Other Server · X"

    restored[0] = [SERVER, SERVER2, PLAYER]                    # next start: devices come back without a search
    api.requests.clear()
    page.reload()
    page.wait_for_selector("[data-cid=a]")
    assert picker_labels(page) == ["Other Server · X", "Linn · Majik"]
    assert not any("discover" in r for r in api.requests)
    pick(page, "server", 2)
    assert picker_labels(page)[0] == "Music Server · MinimServer"


def test_if_remembered_devices_dont_come_back_the_app_searches_once(page, api):
    api.routes.update({"devices/restore": {"devices": []}, "discover": {"devices": [SERVER, PLAYER]},
                       "browse": browse({"0": []})})
    page.add_init_script("localStorage.setItem('flou_server','srv1'); localStorage.setItem('flou_renderer','ren1')")
    open_app(page)
    page.wait_for_function("document.querySelector('#server').value === 'srv1'")
    assert picker_labels(page) == ["Music Server · MinimServer", "Linn · Majik"]
    assert sum("discover" in r for r in api.requests) == 1


# ---------- live browsing ----------

def start_live(page, api, tree):
    api.routes.update({"browse": browse(tree), "devices/restore": {"devices": [SERVER, PLAYER]}})
    page.add_init_script("localStorage.setItem('flou_server','srv1'); localStorage.setItem('flou_renderer','ren1')")
    open_app(page)
    page.wait_for_selector("[data-cid]")


TREE = {"0": [{"type": "container", "id": "a", "title": "Albums"}, {"type": "container", "id": "z", "title": "Other"}],
        "a": [{"type": "container", "id": "alb1", "title": "Album One"}],
        "alb1": [track(1), track(2), track(3)], "z": []}


def test_live_browsing_navigation(page, api):
    start_live(page, api, TREE)
    assert page.inner_text(".crumbs").strip() == "Home"
    page.click("[data-cid=a]"); page.click("[data-cid=alb1]")
    page.wait_for_selector("[data-item=t2]")
    assert page.inner_text(".crumbs").replace("\n", "") == "Home›Albums›Album One"
    page.click(".crumb[data-depth='0']")
    page.wait_for_selector("[data-cid=a]")
    page.click("[data-cid=a]"); page.keyboard.press("Backspace")          # Backspace goes one folder up, even before the folder has finished loading
    page.wait_for_selector("[data-cid=a]")


def test_the_cover_shows_the_album_artist_and_the_artist_column_is_optional(page, api):
    tree = dict(TREE, alb1=[track(1, album_artist="The Band"), track(2, album_artist="The Band")])
    start_live(page, api, tree)
    page.click("[data-cid=a]"); page.click("[data-cid=alb1]")
    page.wait_for_selector("[data-item=t1]")
    assert page.inner_text(".albuminfo .albumartist") == "The Band"
    assert page.query_selector("td.artist") is None                       # hidden by default
    page.click("#colToggle")
    labels = page.eval_on_selector_all("#colMenu label", "ls => ls.map(l => l.textContent.trim() + ':' + l.querySelector('input').checked)")
    assert "Artist:false" in labels and not any(l.startswith("Album Artist") for l in labels)
    page.check("#colMenu input[data-col=artist]")
    assert page.query_selector("td.artist") is not None


def test_an_untagged_album_shows_the_shared_artist_next_to_the_cover(page, api):
    start_live(page, api, TREE)
    page.click("[data-cid=a]"); page.click("[data-cid=alb1]")
    page.wait_for_selector("[data-item=t1]")
    assert page.inner_text(".albuminfo .albumartist") == "Artist X"


def test_now_playing_returns_to_the_folder_of_the_playing_track(page, api):
    start_live(page, api, TREE)
    api.routes["control"] = {"ok": True}
    page.click("[data-cid=a]"); page.click("[data-cid=alb1]")
    page.dblclick("[data-item=t2]")
    page.wait_for_function("!document.querySelector('#jumpNowPlaying').disabled")
    page.click(".crumb[data-depth='0']")                                   # leave the folder
    page.wait_for_selector("[data-cid=a]")
    page.click("#jumpNowPlaying")
    page.wait_for_selector("[data-item=t2]")
    assert page.get_attribute("tr.playing", "data-item") == "t2"
    assert api.actions() == ["set_uri"]


def test_switching_between_live_and_cached(page, api):
    start_live(page, api, TREE)
    page.click("#libMode [data-mode=cached]")
    assert page.evaluate("document.documentElement.dataset.libmode") == "cached"
    assert page.is_visible("#loadLibrary") and page.is_visible(".facets")
    page.click("#libMode [data-mode=live]")
    page.wait_for_selector("[data-cid]")
    assert not page.is_visible("#loadLibrary")


# ---------- keyboard ----------

def test_keyboard_control_of_playback(page, api):
    api.routes.update({"/volume": {"kind": "openhome", "raw": 40, "max": 100, "unity": 80, "db_per_step": .5, "db": -20, "percent": 40, "muted": False},
                       "control": {"ok": True}})
    open_app(page)
    select_renderer(page)
    page.wait_for_selector("#muteBtn:not(.hidden)")
    api.actions()

    def press(key, expect):
        page.keyboard.press(key)
        page.wait_for_timeout(250)
        assert api.actions() == expect, key

    press("Space", ["play"])                                               # nothing is playing -> play
    page.evaluate("setProgress(30, 200, true, true)")
    press("Space", ["pause"])                                              # playing -> pause
    press("Shift+ArrowRight", ["seek:40"])
    press("Shift+ArrowLeft", ["seek:30"])
    press("Control+.", ["stop"])
    press("Control+m", ["mute:1"])
    page.keyboard.press("Control+ArrowUp"); page.wait_for_timeout(500)
    assert api.actions() == ["volume:41"]


def test_keys_are_ignored_while_typing_or_in_a_dialog(page, api):
    api.routes["control"] = {"ok": True}
    open_app(page)
    select_renderer(page)
    api.actions()
    page.click("#search"); page.keyboard.type("a b"); page.keyboard.press("Space")
    assert page.input_value("#search") == "a b " and api.actions() == []   # the space is typed, not a shortcut
    page.evaluate("document.activeElement.blur()")
    page.click("#aboutBtn")
    page.keyboard.press("Space"); page.wait_for_timeout(200)
    assert api.actions() == []


# ---------- OpenHome device controls ----------

def device_routes(api, **over):
    api.routes.update({
        "/volume": {"kind": "openhome", "raw": 40, "max": 100, "unity": 80, "db_per_step": .5, "db": -20, "percent": 40, "muted": False},
        "/standby": {"supported": True, "standby": True},
        "/capabilities": {"supported": True, "can_pause": False, "can_skip_next": False, "can_skip_previous": True},
        "/sources": {"current": 1, "sources": [{"index": 0, "type": "Playlist", "name": "Playlist"}, {"index": 1, "type": "Radio", "name": "Radio"}]},
        "/pins": {"supported": True, "pins": [{"slot": 0, "title": "Classic FM", "artwork": ""}, {"slot": 3, "title": "Chill", "artwork": ""}]},
        "/stream": {"supported": True, "codec": "FLAC", "sample_rate": 44100, "bit_depth": 16, "bit_rate": 1011000},
        "/firmware": {"supported": True, "status": "update_available", "version": "4.99.491", "channel": "release", "update": {"version": "4.100.502", "date": "d"}},
        "/services": {"name": "Linn", "model": "Majik", "peers": []},
        "control": {"ok": True},
    })
    api.routes.update(over)


def test_device_controls_appear_only_for_an_openhome_device(page, api):
    device_routes(api)
    open_app(page)
    assert not page.is_visible("#devTools")
    select_renderer(page)
    page.wait_for_selector("#pinsBox:not(.hidden)")
    # next to the output device in the toolbar, not in the header
    assert page.evaluate("document.querySelector('#devTools').parentElement.className") == "toolbar"
    assert page.is_visible("#sourceSel") and page.is_visible("#powerBtn") and page.is_visible("#muteBtn")
    assert page.input_value("#sourceSel") == "1"
    assert page.inner_text("#npQuality") == "FLAC · 44.1 kHz · 16 bit · 1011 kbps"


def test_standby_source_pins_and_mute_send_the_right_requests(page, api):
    device_routes(api)
    open_app(page)
    select_renderer(page)
    page.wait_for_selector("#pinsBox:not(.hidden)")
    api.actions()
    assert "standby" in page.get_attribute("#powerBtn", "class")           # device is in standby
    page.click("#powerBtn")
    page.select_option("#sourceSel", "0")
    page.click("#pinsBtn"); page.click(".pin[data-slot='3']")
    assert not page.is_visible("#pinList")                                 # the menu closes after a click
    page.click("#muteBtn")
    page.wait_for_timeout(300)
    assert api.actions() == ["standby:0", "set_source:0", "invoke_pin:3", "mute:1"]


def test_buttons_the_source_cant_do_are_greyed_out(page, api):
    device_routes(api)
    open_app(page)
    select_renderer(page)
    page.wait_for_function("document.querySelector('.transport [data-action=pause]').classList.contains('nocap')")
    nocap = page.eval_on_selector_all(".transport [data-action]", "bs => bs.filter(b => b.classList.contains('nocap')).map(b => b.dataset.action)")
    assert sorted(nocap) == ["next", "pause"]    # next: the device (Radio) does the skipping and can't; previous can


def test_firmware_shows_in_device_info(page, api):
    device_routes(api)
    open_app(page)
    select_renderer(page)
    page.click("#diagBtn"); page.click("#diagDevice")
    page.wait_for_function("document.querySelector('#diagList').textContent.includes('Firmware')")
    assert "4.99.491 (release) -- update available: 4.100.502" in page.inner_text("#diagList")


# ---------- layout ----------

def test_layout(page, api):
    open_app(page)
    assert page.query_selector("aside, .now") is None                      # no Now Playing panel any more
    assert page.evaluate("document.querySelector('.statusbar').parentElement.className") == "app"
    # the last element in the flow (the dialogs after it are fixed overlays)
    assert page.evaluate("[...document.querySelector('.app').children].filter(e => { const c = getComputedStyle(e); return c.position !== 'fixed' && c.display !== 'none' }).pop().className") == "statusbar"
    assert page.evaluate("document.documentElement.scrollHeight <= innerHeight")
    page.evaluate("setNowCover('data:image/gif;base64,R0lGODlhAQABAAAAACw=')")
    assert page.is_visible("#npCover")                                      # cover thumbnail in the title display
    page.evaluate("logErr('x')")
    assert page.inner_text("#diagBadge") == "1"


def test_about_dialog_shows_version_and_source(page, api):
    api.routes["app/about"] = {"name": "Flou Player", "version": "1.2.3", "build": "abc", "source": {"describe": "v1.2.3-4-gabc", "commit": "abc", "date": "2026-01-01"},
                               "license": "GPL", "python": "3", "platform": "x", "repo": "https://example.org/r", "changelog": "https://example.org/c", "dependencies": {}}
    open_app(page)
    page.click("#aboutBtn")
    page.wait_for_function("document.querySelector('#aboutVersion').textContent.includes('1.2.3')")
    assert "v1.2.3-4-gabc" in page.inner_text("#aboutTable")
