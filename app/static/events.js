// Device events: the backend subscribes to the output device's events (app/events.py) and tells the page at
// once which of its services changed, so the display follows the device without waiting for the next poll.
// The polls keep running: while events arrive they are answered from what the device sent (no request to the
// device), and without events (a device that doesn't offer them, a firewall) they work as before.
// (Classic script: shares one global scope with the other files, loaded in the order given in index.html.)

let devEvents = null,
  devEventsFor = null,
  devEventsStatus = '',
  devEventsLive = [],
  devEventsLogTimer = null;
function watchDeviceEvents() {
  const d = dev2();
  if (d === devEventsFor) return;
  devEvents?.close();
  devEvents = null;
  devEventsFor = d;
  devEventsStatus = '';
  clearTimeout(devEventsLogTimer); // a pending log line belongs to the previous device
  if (!d || typeof EventSource === 'undefined') return;
  const es = new EventSource(`/api/devices/${encodeURIComponent(d)}/events`);
  devEvents = es;
  // A dropped connection is retried by the EventSource itself; a refusal (no events on this device) closes it.
  es.onmessage = (e) => {
    if (es !== devEvents) return;
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch (x) {
      return;
    }
    onDeviceEvent(msg);
  };
}
// The services' first events arrive one after the other: the log names them once they are all in.
const DEV_EVENTS_LOG_DELAY_MS = 2000;
function onDeviceEvent(msg) {
  devEventsLive = msg.live || [];
  if (msg.status !== devEventsStatus) {
    devEventsStatus = msg.status;
    clearTimeout(devEventsLogTimer);
    if (msg.status === 'live')
      devEventsLogTimer = setTimeout(
        () => log(`Device events: on (${devEventsLive.join(', ')}) -- the display follows the device at once`),
        DEV_EVENTS_LOG_DELAY_MS,
      );
    else if (msg.status === 'polling')
      log(
        `Device events: not available${msg.reason ? ' -- ' + msg.reason : ''}; asking the device every few seconds`,
        'warn',
      );
  }
  const changed = new Set(msg.changed || []);
  if (!changed.size) return;
  if (['Playlist', 'Time', 'Product'].some((s) => changed.has(s))) pollQueue();
  if (changed.has('Info')) pollStream(true);
  if (changed.has('Product')) {
    pollSource();
    pollStandby();
    pollCaps(true);
  }
  if (changed.has('Volume') && !volDragging && volTimer === null) refreshVolume();
}
$('#renderer').addEventListener('change', watchDeviceEvents);
watchDeviceEvents();
