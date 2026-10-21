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


def test_enter_searches_the_whole_server_and_results_open_like_folders(page, api):
    import json
    queries = []
    def search(req):
        queries.append(json.loads(req.post_data)["query"])
        items = [{"type": "container", "id": "alb1", "title": "Album One"}, track(7, album="Elsewhere"), track(5, album="Elsewhere")]
        return {"items": items, "number_returned": 1, "total_matches": 1}
    api.routes["search"] = search
    start_live(page, api, TREE)
    page.fill("#search", "Trac")                                   # typing alone only filters the open folder
    page.wait_for_timeout(200)
    assert queries == []
    page.press("#search", "Enter")
    page.wait_for_selector("[data-item=t7]")
    assert queries == ["Trac"] and page.input_value("#search") == ""
    assert page.eval_on_selector_all("[data-item]", "rs => rs.map(r => r.dataset.item)") == ["t5", "t7"]   # back in track order
    assert page.inner_text(".crumbs").replace("\n", "") == "Home›Search “Trac”"
    page.click("[data-cid=alb1]")                                   # an album found by the search opens like a folder
    page.wait_for_selector("[data-item=t1]")
    assert page.inner_text(".crumbs").replace("\n", "") == "Home›Search “Trac”›Album One"
    page.click(".crumb[data-depth='1']")                            # and back to the results
    page.wait_for_selector("[data-item=t7]")
    assert queries == ["Trac", "Trac"]


def test_the_search_can_be_reset_back_to_the_folder_before_it(page, api):
    api.routes["search"] = {"items": [track(7, album="Elsewhere")], "number_returned": 1, "total_matches": 1}
    start_live(page, api, TREE)
    page.click("[data-cid=a]"); page.wait_for_selector("[data-cid=alb1]")
    assert not page.is_visible("#searchClear")
    page.fill("#search", "x")
    assert page.is_visible("#searchClear")                          # × appears with text
    page.press("#search", "Enter"); page.wait_for_selector("[data-item=t7]")
    assert page.is_visible("#searchClear")                          # ... and stays while in the search
    page.click("#searchClear")
    page.wait_for_selector("[data-cid=alb1]")                       # back in "Albums", where the search started
    assert page.inner_text(".crumbs").replace("\n", "") == "Home›Albums"
    assert not page.is_visible("#searchClear")
    page.fill("#search", "zzz"); page.press("#search", "Escape")    # Esc clears a typed filter
    assert page.input_value("#search") == "" and page.is_visible("[data-cid=alb1]")


def test_the_cover_shows_the_album_artist_and_the_artist_column_is_optional(page, api):
    tree = dict(TREE, alb1=[track(1, album_artist="The Band"), track(2, album_artist="The Band")])
    start_live(page, api, tree)
    page.click("[data-cid=a]"); page.click("[data-cid=alb1]")
    page.wait_for_selector("[data-item=t1]")
    assert page.text_content(".albuminfo .albumartist")   # not inner_text: .album uses content-visibility, so it is empty until first painted == "The Band"
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
    assert page.text_content(".albuminfo .albumartist")   # not inner_text: .album uses content-visibility, so it is empty until first painted == "Artist X"


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


def test_switching_between_live_and_library(page, api):
    start_live(page, api, TREE)
    page.click("#tabLibrary")
    assert page.evaluate("document.documentElement.dataset.libmode") == "cached"
    assert page.is_visible("#loadLibrary") and page.is_visible(".facets")
    assert "active" in page.get_attribute("#tabLibrary", "class") and "active" not in page.get_attribute("#tabLive", "class")
    page.click("#tabLive")
    page.wait_for_selector("[data-cid]")
    assert not page.is_visible("#loadLibrary") and not page.is_visible("#clearLibrary")
    assert "active" in page.get_attribute("#tabLive", "class")


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
    assert "developed with ai assistance" in page.inner_text("#aboutModal").lower()


def test_backend_errors_read_as_messages_not_json_parse_errors(page, api):
    api.routes["invalid"] = (422, {"detail": [{"loc": ["body", "value"], "msg": "Input should be a valid integer"}]})
    api.routes["refused"] = (400, {"detail": "No volume service on this device"})
    page.route("**/api/crash", lambda route: route.fulfill(status=500, body="Internal Server Error", content_type="text/plain"))
    open_app(page)
    msg = lambda url: page.evaluate("u => api(u).then(() => 'ok', e => e.message)", url)
    assert msg("/api/crash") == "The background service answered 500 Internal Server Error: Internal Server Error (/api/crash)"
    assert msg("/api/invalid") == "Input should be a valid integer"
    assert msg("/api/refused") == "No volume service on this device"


# ---------- album order ----------

def test_albums_are_ordered_by_album_artist_then_album(page, api):
    def t(i, album, album_artist="", artist="Someone"):
        return dict(track(i, album=album, album_artist=album_artist, artist=artist), id=f"x{i}")
    tracks = [t(1, "Zed", "Apple Band"), t(2, "Alpha", "Zebra Band"), t(3, "Beta", "Apple Band"),
              t(4, "Loner", artist="Mid Artist"),                    # untagged: sorted by its artist
              t(5, "Nobody", artist="")]                             # no artist at all: last
    api.routes["library/cached"] = {"tracks": tracks, "count": len(tracks), "scan_root": "root", "scanned_at": 1}
    page.add_init_script("localStorage.setItem('flou_libmode','cached')")
    open_app(page)
    page.wait_for_selector(".album")
    albums = page.eval_on_selector_all(".album .albumtitle", "ts => ts.map(t => t.textContent.replace(/ \\(\\d+\\)$/, ''))")
    assert albums == ["Beta", "Zed", "Loner", "Alpha", "Nobody"]


# ---------- quality filter ----------

def audio_track(i, mime, rate="", bits="", album="A"):
    t = track(i, album=album, album_artist="Band")
    t["id"] = f"q{i}"
    t["resources"] = [{"uri": f"u{i}", "protocol": f"http-get:*:{mime}:*", "duration": "0:03:00", "sample_rate": rate, "bits_per_sample": bits}]
    return t


QUALITY_TRACKS = [
    audio_track(1, "audio/flac", "44100", "16"),      # cd
    audio_track(2, "audio/flac", "96000", "24"),      # hires
    audio_track(3, "audio/flac", "48000", "16"),      # cd (48 kHz is still CD-class)
    audio_track(4, "audio/mpeg", "44100"),            # lossy
    audio_track(5, "audio/mp4", "44100"),             # AAC (no bit depth) -> lossy
    audio_track(6, "audio/mp4", "44100", "16"),       # ALAC states its bit depth -> lossless
    audio_track(7, "audio/flac", "192000", "24"),     # hires
    audio_track(8, "application/x-unknown"),          # can't tell
]


def test_tracks_are_classified_by_audio_quality(page, api):
    open_app(page)
    got = page.evaluate("ts => ts.map(t => qualityClass(t))", QUALITY_TRACKS)
    assert got == ["cd", "hires", "cd", "lossy", "lossy", "cd", "hires", ""]


def test_the_quality_filter_narrows_the_track_list(page, api):
    api.routes["library/cached"] = {"tracks": QUALITY_TRACKS, "count": len(QUALITY_TRACKS), "scan_root": "root", "scanned_at": 1}
    page.add_init_script("localStorage.setItem('flou_libmode','cached')")
    open_app(page)
    page.wait_for_selector(".album")

    def shown(value):
        page.select_option("#qualityFilter", value)
        page.wait_for_timeout(150)
        return page.eval_on_selector_all("[data-item]", "rs => rs.map(r => r.dataset.item).sort()")

    assert len(shown("")) == 8                                             # all, incl. the one we can't classify
    assert shown("hires") == ["q2", "q7"]
    assert shown("cd") == ["q1", "q3", "q6"]
    assert shown("lossless") == ["q1", "q2", "q3", "q6", "q7"]
    assert shown("lossy") == ["q4", "q5"]
    assert "2 tracks" in page.inner_text("#count")                         # the counter follows the filter
    page.select_option("#qualityFilter", "")
    assert len(page.eval_on_selector_all("[data-item]", "rs => rs")) == 8


def test_the_quality_filter_also_works_in_live_mode(page, api):
    tree = {"0": [{"type": "container", "id": "a", "title": "Albums"}], "a": QUALITY_TRACKS}
    start_live(page, api, tree)
    page.click("[data-cid=a]")
    page.wait_for_selector("[data-item=q1]")
    page.select_option("#qualityFilter", "lossy")
    page.wait_for_timeout(150)
    assert page.eval_on_selector_all("[data-item]", "rs => rs.map(r => r.dataset.item).sort()") == ["q4", "q5"]


# ---------- volume display ----------

def test_the_volume_shows_the_device_step_and_the_db(page, api):
    api.routes.update({"/volume": {"kind": "openhome", "raw": 33, "max": 100, "unity": 100, "db_per_step": .7179, "db": -48.1, "percent": 33, "muted": False},
                       "control": {"ok": True}})
    open_app(page)
    select_renderer(page)
    page.wait_for_function("document.querySelector('#volumeLabel').textContent.includes('33')")
    assert page.inner_text("#volumeLabel .volstep") == "33"                     # the step as the Linn shows it (bold, larger) ...
    assert page.inner_text("#volumeLabel .voldb") == "-48.1 dB"                 # ... then the dB
    assert page.evaluate("getComputedStyle(document.querySelector('#volumeLabel .volstep')).fontWeight") in ("700", "bold")
    page.evaluate("() => { const v = document.querySelector('#volume'); v.value = 34; v.dispatchEvent(new Event('input')) }")
    assert (page.inner_text("#volumeLabel .volstep"), page.inner_text("#volumeLabel .voldb")) == ("34", "-47.4 dB")   # live while dragging


def test_a_device_without_db_values_shows_a_percentage(page, api):
    api.routes["/volume"] = {"kind": "renderingcontrol", "raw": 33, "max": 100, "db": None, "percent": 33}
    open_app(page)
    select_renderer(page)
    page.wait_for_function("document.querySelector('#volumeLabel').textContent.includes('33')")
    assert page.inner_text("#volumeLabel") == "33%" and page.query_selector("#volumeLabel .voldb") is None


# ---------- shortcut overview ----------

def test_the_shortcut_overview_opens_and_closes(page, api):
    api.routes["control"] = {"ok": True}
    open_app(page)
    select_renderer(page)
    api.actions()
    assert not page.is_visible("#keysModal")
    page.keyboard.press("Control+/")
    assert page.is_visible("#keysModal")
    text = page.inner_text("#keysBody")
    assert "Play / pause" in text and "Jump to the playing track" in text and "Show this overview" in text
    page.keyboard.press("Space"); page.wait_for_timeout(200)
    assert api.actions() == []                                              # playback keys are off while it is open
    page.keyboard.press("Escape")
    assert not page.is_visible("#keysModal")
    page.keyboard.press("F1")
    assert page.is_visible("#keysModal")
    page.keyboard.press("F1")                                               # toggles
    assert not page.is_visible("#keysModal")
    page.click("#keysBtn")
    assert page.is_visible("#keysModal")
    page.click("#keysModal", position={"x": 5, "y": 5})                     # a click on the backdrop closes it
    assert not page.is_visible("#keysModal")


def test_the_overview_lists_what_the_user_guide_documents(page, api):
    """The overview and docs/user-guide.md must not drift apart."""
    import pathlib
    open_app(page)
    shortcuts = page.evaluate("SHORTCUTS.flatMap(([, rows]) => rows)")
    guide = (pathlib.Path(__file__).resolve().parent.parent / "docs" / "user-guide.md").read_text(encoding="utf-8")
    missing = [keys for keys, _ in shortcuts if f"| {keys} |" not in guide]
    assert not missing, f"shortcuts in the overview but not in docs/user-guide.md: {missing}"


# ---------- next / previous with the keyboard ----------

def start_cached_with_player(page, api, tracks):
    api.routes.update({"library/cached": {"tracks": tracks, "count": len(tracks), "scan_root": "root", "scanned_at": 1}, "control": {"ok": True}})
    page.add_init_script("localStorage.setItem('flou_libmode','cached')")
    open_app(page)
    select_renderer(page)
    page.wait_for_selector(".album")


def test_ctrl_arrows_step_through_the_displayed_tracks_in_the_cached_library(page, api):
    start_cached_with_player(page, api, [dict(track(i, album_artist="Band"), id=f"c{i}") for i in (1, 2, 3)])
    page.dblclick("[data-item=c1]"); page.wait_for_timeout(150)
    uris = lambda: [p["uri"] for p in api.posts if p.get("action") == "set_uri"]
    assert uris() == ["u1"]
    page.keyboard.press("Control+ArrowRight"); page.wait_for_timeout(200)
    assert uris() == ["u1", "u2"]                                           # next
    assert page.get_attribute("tr.playing", "data-item") == "c2"
    page.keyboard.press("Control+ArrowLeft"); page.wait_for_timeout(200)
    assert uris() == ["u1", "u2", "u1"]                                     # previous
    page.keyboard.press("Control+ArrowLeft"); page.wait_for_timeout(200)
    assert len(uris()) == 3                                                 # nothing before the first track
    page.dblclick("[data-item=c3]"); page.wait_for_timeout(150)
    page.keyboard.press("Control+ArrowRight"); page.wait_for_timeout(200)
    assert uris()[-1] == "u3"                                               # nothing after the last track


def queue_api(fail=False):
    """A renderer with an OpenHome playlist: GET reads it, POST changes it (or fails)."""
    def answer(req):
        if req.method == "POST" and fail:
            return 502, {"detail": "Playlist action failed"}
        return {"ok": True} if req.method == "POST" else {"active": False, "token": 1, "entries": [], "current_id": 0, "state": "Stopped"}
    return answer


def test_double_click_on_an_openhome_device_plays_the_album_through_the_device_queue(page, api):
    api.routes["/queue"] = queue_api()
    start_cached_with_player(page, api, [dict(track(i, album_artist="Band"), id=f"c{i}") for i in (1, 2, 3)])
    page.wait_for_function("queue.supported")
    page.dblclick("[data-item=c2]"); page.wait_for_timeout(200)
    replace = [p for p in api.posts if p.get("action") == "replace"]
    assert [i["uri"] for i in replace[0]["items"]] == ["u1", "u2", "u3"] and replace[0]["start"] == 1   # whole album, from track 2
    assert not [p for p in api.posts if p.get("action") == "set_uri"]


def test_if_the_device_queue_fails_double_click_falls_back_to_the_single_track(page, api):
    api.routes["/queue"] = queue_api(fail=True)
    start_cached_with_player(page, api, [dict(track(i, album_artist="Band"), id=f"c{i}") for i in (1, 2)])
    page.wait_for_function("queue.supported")
    page.dblclick("[data-item=c2]"); page.wait_for_timeout(300)
    assert [p["uri"] for p in api.posts if p.get("action") == "set_uri"] == ["u2"]


def test_media_keys_control_playback_and_the_panel_sees_the_track(page, api):
    reported, keys = [], []
    api.routes["media/state"] = lambda req: reported.append(__import__("json").loads(req.post_data)) or {"ok": True}
    api.routes["media/command"] = lambda req: {"command": keys.pop(0) if keys else None}
    start_cached_with_player(page, api, [dict(track(i, album_artist="Band"), id=f"c{i}") for i in (1, 2)])
    page.dblclick("[data-item=c1]"); page.wait_for_timeout(200)
    keys.append("next")                                                                     # media key "next"
    page.wait_for_function("document.querySelector('tr.playing')?.dataset.item === 'c2'", timeout=8000)   # the "next" key
    assert [p["uri"] for p in api.posts if p.get("action") == "set_uri"] == ["u1", "u2"]
    page.wait_for_timeout(1300)
    assert reported[-1]["title"] == "Track 2" and reported[-1]["artist"] == "Artist X" and reported[-1]["album"] == "Album One"


def test_without_a_device_queue_double_click_plays_the_single_track(page, api):
    start_cached_with_player(page, api, [dict(track(i, album_artist="Band"), id=f"c{i}") for i in (1, 2)])
    page.dblclick("[data-item=c2]"); page.wait_for_timeout(200)
    assert [p["uri"] for p in api.posts if p.get("action") == "set_uri"] == ["u2"]
    assert not [p for p in api.posts if p.get("action") == "replace"]


def test_next_follows_the_filtered_list_and_does_nothing_when_the_playing_track_is_hidden(page, api):
    tracks = [audio_track(1, "audio/flac", "44100", "16"), audio_track(2, "audio/mpeg", "44100"), audio_track(3, "audio/flac", "96000", "24")]
    start_cached_with_player(page, api, tracks)
    page.select_option("#qualityFilter", "lossless"); page.wait_for_timeout(150)     # q1 and q3 remain
    page.dblclick("[data-item=q1]"); page.wait_for_timeout(150)
    page.keyboard.press("Control+ArrowRight"); page.wait_for_timeout(200)
    assert [p["uri"] for p in api.posts if p.get("action") == "set_uri"] == ["u1", "u3"]   # skips the hidden MP3
    page.select_option("#qualityFilter", "lossy"); page.wait_for_timeout(150)         # the playing track (q3) is now hidden
    api.posts.clear()
    page.keyboard.press("Control+ArrowRight"); page.wait_for_timeout(200)
    assert api.posts == []


def test_ctrl_arrows_step_through_the_open_folder_in_live_mode(page, api):
    tree = {"0": [{"type": "container", "id": "a", "title": "Albums"}], "a": [track(1), track(2), track(3)]}
    start_live(page, api, tree)
    api.routes["control"] = {"ok": True}
    page.click("[data-cid=a]")
    page.dblclick("[data-item=t2]"); page.wait_for_timeout(150)
    page.keyboard.press("Control+ArrowRight"); page.wait_for_timeout(200)
    page.keyboard.press("Control+ArrowLeft"); page.wait_for_timeout(200)
    page.keyboard.press("Control+ArrowLeft"); page.wait_for_timeout(200)
    assert [p["uri"] for p in api.posts if p.get("action") == "set_uri"] == ["u2", "u3", "u2", "u1"]


# ---------- library health ----------

def htrack(i, album="A", album_artist="", artist="", art="x.jpg", year="2001", genre="Rock", number=None, title=None, quality_mime="audio/flac", rate="44100", bits="16"):
    return {"type": "item", "id": f"h{i}", "title": title or f"Song {i}", "artist": artist, "album": album, "album_artist": album_artist, "album_art": art,
            "date": year, "genre": genre, "track_number": str(number if number is not None else i), "class": "object.item.audioItem.musicTrack",
            "resources": [{"uri": f"u{i}", "protocol": f"http-get:*:{quality_mime}:*", "duration": "0:03:00", "sample_rate": rate, "bits_per_sample": bits}]}


def analyze(page, tracks):
    return page.evaluate("""ts => { enrichTracks(ts); const r = analyzeLibrary(ts);
        return Object.fromEntries(r.checks.map(c => [c.id, c.items.map(i => [i.albumArtist, i.artist, i.album, i.note])])) }""", tracks)


def test_health_finds_artist_tag_problems(page, api):
    open_app(page)
    r = analyze(page, [
        htrack(1, album="Only AA", album_artist="AA", artist=""),                  # Album Artist but no Artist
        htrack(2, album="Only Artist", album_artist="", artist="Solo"),            # Artist but no Album Artist
        htrack(3, album="Nobody", album_artist="", artist=""),                     # neither
        htrack(4, album="Fine", album_artist="AA", artist="AA"),
    ])
    assert [x[2] for x in r["aa_no_artist"]] == ["Only AA"] and "1 of 1 track" in r["aa_no_artist"][0][3]
    assert [x[2] for x in r["artist_no_aa"]] == ["Only Artist"]
    assert [x[2] for x in r["no_artist"]] == ["Nobody"]


def test_health_finds_missing_cover_year_genre_and_title(page, api):
    open_app(page)
    r = analyze(page, [
        htrack(1, album="No cover", album_artist="B", artist="B", art=""),
        htrack(2, album="Part cover", album_artist="B", artist="B", art=""), htrack(3, album="Part cover", album_artist="B", artist="B"),
        htrack(4, album="Bare", album_artist="B", artist="B", year="", genre=""),
        htrack(5, album="", album_artist="B", artist="B"),
    ])
    assert [x[2] for x in r["no_cover"]] == ["No cover"]
    assert [x[2] for x in r["partial_cover"]] == ["Part cover"]
    assert [x[2] for x in r["no_year"]] == ["Bare"] and [x[2] for x in r["no_genre"]] == ["Bare"]
    assert len(r["no_album"]) == 1


def test_health_checks_track_numbers_duplicates_and_mixed_quality(page, api):
    open_app(page)
    r = analyze(page, [
        htrack(1, album="Gaps", album_artist="C", artist="C", number=1), htrack(2, album="Gaps", album_artist="C", artist="C", number=3),
        htrack(3, album="Repeat", album_artist="C", artist="C", number=1), htrack(4, album="Repeat", album_artist="C", artist="C", number=1),
        htrack(5, album="Nums", album_artist="C", artist="C", number=0), htrack(6, album="Nums", album_artist="C", artist="C", number=1),
        htrack(7, album="Dup", album_artist="C", artist="C", title="Same"), htrack(8, album="Dup", album_artist="C", artist="C", title="same!"),
        htrack(9, album="Mixed", album_artist="C", artist="C", number=1), htrack(10, album="Mixed", album_artist="C", artist="C", number=2, quality_mime="audio/mpeg", rate="", bits=""),
        htrack(11, album="Single", album_artist="C", artist="C"),
    ])
    notes = {x[2]: x[3] for x in r["track_numbers"]}
    assert "missing: 2" in notes["Gaps"] and "repeated: 1" in notes["Repeat"] and "1 without number" in notes["Nums"]
    assert [x[2] for x in r["dup_titles"]] == ["Dup"]
    assert [x[2] for x in r["mixed_quality"]] == ["Mixed"]
    assert [x[2] for x in r["single_track"]] == ["Single"]
    assert "Song 11" not in str(r["track_numbers"])                                  # a one-track album has no numbering to check


def test_health_finds_split_albums_and_spelling_variants(page, api):
    open_app(page)
    r = analyze(page, [
        htrack(1, album="Hits", album_artist="The Band", artist="The Band"), htrack(2, album="Hits", album_artist="", artist="The Band"),
        htrack(3, album="Other", album_artist="Beatles", artist="Beatles"), htrack(4, album="Other 2", album_artist="The Beatles", artist="The Beatles"),
        htrack(5, album="Third", album_artist="beatles", artist="Beatles"),
    ])
    assert [(x[2], x[3]) for x in r["split_aa"]] == [("Hits", 'also exists with Album Artist "The Band"')]
    names = [x[0] or x[1] for x in r["variant_names"]]
    assert any("Beatles" in n and "The Beatles" in n for n in names)


def test_the_health_view_lists_the_findings_and_jumps_to_the_album(page, api):
    tracks = [htrack(1, album="Needs love", album_artist="AA", artist="", art=""), htrack(2, album="Fine", album_artist="X", artist="X")]
    api.routes["library/cached"] = {"tracks": tracks, "count": 2, "scan_root": "root", "scanned_at": 1}
    page.add_init_script("localStorage.setItem('flou_libmode','cached')")
    open_app(page)
    page.wait_for_selector(".album")
    page.click("#healthBtn")
    assert page.is_visible("#healthView") and not page.is_visible(".facets")
    assert "2 albums" in page.inner_text("#healthInfo") and "with findings" in page.inner_text("#healthInfo")
    counts = page.eval_on_selector_all(".hcheck", "bs => Object.fromEntries(bs.map(b => [b.dataset.check, b.querySelector('.hcount').textContent]))")
    assert counts["aa_no_artist"] == "1" and counts["no_cover"] == "1" and counts["no_artist"] == "✓"
    assert "Needs love" in page.inner_text("#healthDetail")                    # the first check is selected
    page.click(".hcheck[data-check=no_cover]")
    assert "Needs love" in page.inner_text("#healthDetail")
    page.click("#healthDetail tr[data-row='0']")                               # jump to the album in the library
    assert page.evaluate("document.querySelector('main').dataset.tab") == "library"
    assert page.input_value("#search") == "Needs love"
    assert page.eval_on_selector_all(".albumtitle", "ts => ts.map(t => t.textContent)") == ["Needs love (1)"]


def test_clear_library_empties_the_list_and_deletes_the_cache(page, api):
    tracks = [htrack(1, album="Needs love", album_artist="AA", artist="X")]
    api.routes["library/cached"] = {"tracks": tracks, "count": 1, "scan_root": "root", "scanned_at": 1}
    page.add_init_script("localStorage.setItem('flou_libmode','cached')")
    open_app(page)
    page.wait_for_selector(".album")
    page.on("dialog", lambda d: d.accept())
    page.click("#clearLibrary")
    page.wait_for_function("!document.querySelector('.album')")
    assert "cleared" in page.inner_text("#breadcrumb").lower()
    assert "DELETE library/cached" in api.requests


def test_the_health_view_explains_when_there_is_no_scanned_library(page, api):
    page.add_init_script("localStorage.setItem('flou_libmode','cached')")
    open_app(page)
    page.click("#healthBtn")
    assert page.is_visible("#healthEmpty") and not page.is_visible("#healthBody")


def test_the_health_icon_toggles_the_view_and_is_highlighted_while_open(page, api):
    open_app(page)
    assert page.query_selector("#tabHealth") is None                          # it is an icon in the header, not a tab
    page.click("#healthBtn")
    assert page.evaluate("document.querySelector('main').dataset.tab") == "health"
    assert "active" in page.get_attribute("#healthBtn", "class") and page.get_attribute("#healthBtn", "aria-pressed") == "true"
    page.click("#healthBtn")                                                   # again: back to the library
    assert page.evaluate("document.querySelector('main').dataset.tab") == "library"
    assert "active" not in page.get_attribute("#healthBtn", "class")
    page.click("#healthBtn"); page.click("#tabLibrary")                        # the Library tab also leaves it
    assert page.evaluate("document.querySelector('main').dataset.tab") == "library" and not page.is_visible("#healthView")


# ---------- interface zoom ----------

def test_zoom_keys_scale_the_interface_and_the_level_is_remembered(page, api):
    open_app(page)
    zoom = lambda: page.evaluate("uiZoom")
    assert zoom() == 1
    page.keyboard.press("Control+="); assert zoom() == 1.1
    page.keyboard.press("Control+Equal"); page.keyboard.press("Control+Equal")
    assert zoom() == 1.5
    assert page.evaluate("document.documentElement.style.zoom") == "1.5"
    assert "150%" in page.inner_text("#toast")
    page.reload()
    assert page.evaluate("uiZoom") == 1.5                                       # remembered
    page.keyboard.press("Control+-"); assert zoom() == 1.25
    page.keyboard.press("Control+0"); assert zoom() == 1
    assert page.evaluate("document.documentElement.style.zoom") == ""


def test_the_layout_still_fits_when_zoomed(page, api):
    open_app(page)
    for z in (0.75, 1.5, 2, 3):
        page.set_viewport_size({"width": int(1100 * z), "height": int(650 * z)})   # a screen that is 1100x650 at this zoom
        page.evaluate("z => setZoom(z)", z)
        page.wait_for_timeout(50)
        fits = page.evaluate("""() => { const f = document.querySelector('.statusbar').getBoundingClientRect();
            return [document.documentElement.scrollHeight <= innerHeight + 1, f.bottom <= innerHeight + 1, f.top > 0] }""")
        assert fits == [True, True, True], f"zoom {z}: {fits}"
        page.click("#aboutBtn")
        box = page.evaluate("(() => { const r = document.querySelector('#aboutModal .modal-content').getBoundingClientRect(); return [r.left >= 0, r.top >= 0, r.right <= innerWidth + 1, r.bottom <= innerHeight + 1] })()")
        assert box == [True, True, True, True], f"zoom {z}: about dialog {box}"
        page.keyboard.press("Escape")


def test_the_overview_lists_the_zoom_shortcuts(page, api):
    open_app(page)
    page.keyboard.press("F1")
    text = page.inner_text("#keysBody")
    assert "Zoom the interface" in text and "Reset the zoom" in text


# ---------- "the library on the server has changed" ----------

def test_a_changed_server_library_is_pointed_out_until_reloaded_or_dismissed(page, api):
    tracks = [dict(track(i, album_artist="Band"), id=f"c{i}") for i in (1, 2)]
    state = {"changed": True, "update_id": 8}
    api.routes.update({"library/cached": {"tracks": tracks, "count": 2, "scan_root": "root", "scanned_at": 1},
                       "library/changed": lambda req: {"known": True, **state},
                       "devices/restore": {"devices": [SERVER, PLAYER]},
                       "scan/progress": {"running": False},
                       "scan": {"tracks": tracks, "count": 2, "scan_root": "root", "stats": {}}})
    page.add_init_script("localStorage.setItem('flou_libmode','cached'); localStorage.setItem('flou_server','srv1')")
    open_app(page)
    page.wait_for_selector("#libChanged:not(.hidden)")
    page.click("#libChangedDismiss")                                 # "Not now" ...
    assert page.is_hidden("#libChanged")
    page.reload(); page.wait_for_selector(".album"); page.wait_for_timeout(300)
    assert page.is_hidden("#libChanged")                             # ... stays quiet for this change
    state["update_id"] = 9                                           # the server changes again
    page.reload(); page.wait_for_selector("#libChanged:not(.hidden)")
    page.click("#libChangedReload")                                  # Reload library = a fresh scan
    page.wait_for_function("document.querySelector('#loadLibrary:not(.busy)')")
    assert "POST scan" in api.requests and page.is_hidden("#libChanged")
    page.click("#tabLive")
    assert page.is_hidden("#libChanged")                             # never in Live mode


# ---------- TIDAL ----------

def ttrack(i, available=True):
    return {"id": str(i), "title": f"Tidal {i}", "artist": "Miles", "album": "Kind of Blue", "album_id": "5", "track_number": i,
            "duration": 185, "quality": "LOSSLESS", "album_art": "", "available": available,
            "uri": f"tidal://track?version=1&trackId={i}", "metadata": f"<m{i}/>"}


def tidal_routes(api, logged_in=True):
    api.routes.update({
        "tidal/status": {"available": True, "logged_in": logged_in, "user": "miles@example.org"},
        "tidal/search": {"artists": [{"id": "7", "name": "Miles", "picture": ""}],
                         "albums": [{"id": "5", "title": "Kind of Blue", "artist": "Miles", "year": 1959, "tracks": 3, "quality": "LOSSLESS", "album_art": ""}],
                         "tracks": [ttrack(9)]},
        "tidal/albums/5": {"album": {"id": "5", "title": "Kind of Blue", "artist": "Miles", "year": 1959, "tracks": 3, "quality": "LOSSLESS", "album_art": ""},
                           "tracks": [ttrack(1), ttrack(2, available=False), ttrack(3)]},
        "/tidal": {"supported": True, "user": "miles", "enabled": True, "status": "", "ready": True},
        "/queue": queue_api(),
    })


def test_tidal_search_album_and_play_through_the_device_queue(page, api):
    tidal_routes(api)
    open_app(page)
    select_renderer(page)
    page.wait_for_function("queue.supported")
    page.click("#tidalBtn")
    page.wait_for_selector("#tidalSearch:visible")
    assert page.inner_text("#tidalDevice") == "Device plays TIDAL as miles"
    page.fill("#tidalSearch", "miles"); page.press("#tidalSearch", "Enter")
    page.wait_for_selector("[data-talbum='5']")
    assert page.inner_text(".ttable .title") == "Tidal 9"
    page.click("[data-talbum='5']")
    page.wait_for_selector("[data-tplay]")
    page.click("[data-tplay]"); page.wait_for_timeout(200)
    replace = [p for p in api.posts if p.get("action") == "replace"]
    assert [i["uri"] for i in replace[0]["items"]] == ["tidal://track?version=1&trackId=1", "tidal://track?version=1&trackId=3"]   # unavailable left out
    api.posts.clear()
    page.dblclick("tr[data-ti='2']"); page.wait_for_timeout(200)                     # track 3: the album from there
    replace = [p for p in api.posts if p.get("action") == "replace"]
    assert replace[0]["start"] == 1 and len(replace[0]["items"]) == 2
    page.click("[data-tback]")
    page.wait_for_selector("[data-talbum='5']")
    # the header icon toggles back to the library, and its active state stays readable
    assert page.get_attribute("#tidalBtn", "aria-pressed") == "true"
    page.click("#tidalBtn")
    assert page.evaluate("currentTab()") == "library"


def test_tidal_needs_a_linn_output_device(page, api):
    tidal_routes(api)
    open_app(page)
    page.click("#tidalBtn")
    page.wait_for_selector("#tidalSearch:visible")
    assert "Select a Linn/OpenHome output device" in page.inner_text("#tidalDevice")
    page.fill("#tidalSearch", "miles"); page.press("#tidalSearch", "Enter")
    page.wait_for_selector(".ttable tr[data-ti='0']")
    page.dblclick(".ttable tr[data-ti='0']"); page.wait_for_timeout(200)
    assert not [p for p in api.posts if p.get("action") in ("insert", "replace")]
    assert "output device" in page.inner_text("#toast")


def test_tidal_login_shows_link_and_code(page, api):
    state = {"started": False}
    def status(req):
        if not state["started"]:
            return {"available": True, "logged_in": False}
        return {"available": True, "logged_in": False, "login": {"url": "https://link.tidal.com/ABCDE", "code": "ABCDE", "expires_in": 300}}
    def login(req):
        state["started"] = True
        return status(req)
    api.routes.update({"tidal/status": status, "tidal/login": login})
    open_app(page)
    page.click("#tidalBtn")
    page.wait_for_selector("#tidalLoginStart:visible")
    assert not page.is_visible("#tidalSearch")
    page.click("#tidalLoginStart")
    page.wait_for_selector("#tidalLoginLink:visible")
    assert page.inner_text("#tidalLoginCode") == "ABCDE" and page.get_attribute("#tidalLoginUrl", "href") == "https://link.tidal.com/ABCDE"
    api.routes["tidal/status"] = {"available": True, "logged_in": True, "user": "miles@example.org"}
    page.wait_for_selector("#tidalSearch:visible", timeout=5000)                    # the page notices the login by itself
    assert page.inner_text("#tidalAccount") == "Logged in as miles@example.org"


def test_tidal_explains_when_the_selected_device_has_no_usable_playlist(page, api):
    tidal_routes(api)
    api.routes["/queue"] = lambda req: (502, {"detail": "no playlist"})
    open_app(page)
    select_renderer(page)
    page.click("#tidalBtn")
    page.fill("#tidalSearch", "miles"); page.press("#tidalSearch", "Enter")
    page.wait_for_selector(".ttable tr[data-ti='0']")
    page.dblclick(".ttable tr[data-ti='0']"); page.wait_for_timeout(300)
    assert "no usable playlist" in page.inner_text("#toast")                          # not "select an output device": one is selected
    assert not [p for p in api.posts if p.get("action") in ("insert", "replace")]


def test_a_device_search_that_hangs_can_be_cancelled(page, api):
    api.routes.update({"devices/restore": {"devices": []}, "discover": {"devices": [SERVER, PLAYER]}})
    open_app(page)
    page.evaluate("""() => { const real = window.fetch; window.hang = true;
        window.fetch = (url, opt) => !(window.hang && String(url).includes('/api/discover')) ? real(url, opt)
          : new Promise((_, rej) => opt.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))) }""")
    page.click("#discover")
    assert "Cancel search" in page.inner_text("#discover")
    page.click("#discover")                                                            # the same button cancels
    page.wait_for_function("document.querySelector('#discover').textContent === 'Search devices'")
    assert page.evaluate("logEntries.some(e => e.msg === 'Device search cancelled' && e.level === 'info')")
    assert not page.evaluate("logEntries.some(e => e.level === 'error')")             # a cancel is not an error
    page.evaluate("window.hang = false")
    page.click("#discover")                                                            # and searching works again afterwards
    page.wait_for_function("document.querySelectorAll('#server option').length > 1")
