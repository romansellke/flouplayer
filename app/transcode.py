"""Transcoding for local playback (formats the built-in web engine can't decode are re-encoded to FLAC)."""
from __future__ import annotations
import io
import os
import tempfile
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

router=APIRouter()

# ---------- Transcoding for local playback ----------
# The app window's web engine can't decode AAC/ALAC (.m4a) and a few other
# formats. For local playback such tracks are streamed through here and
# re-encoded to FLAC with PyAV (bundled ffmpeg): lossless for ALAC (24-bit
# stays 24-bit), and for AAC simply the decoded audio. The stream has no
# total length in its header, so seeking isn't possible on these tracks.
class _Sink(io.RawIOBase):
    """Write-only buffer the FLAC muxer writes into; drained chunk by chunk."""
    def __init__(self): self.buf=bytearray()
    def writable(self): return True
    def write(self,b): self.buf+=b; return len(b)
    def drain(self):
        out=bytes(self.buf); self.buf.clear(); return out

def _flac_chunks(av, source, options):
    inp=av.open(source, options=options, timeout=15)
    try:
        ist=inp.streams.audio[0]
        cc=ist.codec_context
        # 32-bit integer decoders (e.g. 24-bit ALAC) keep their resolution.
        fmt="s32" if cc.format.name in ("s32","s32p") else "s16"
        sink=_Sink(); out=av.open(sink,"w",format="flac")
        try:
            ost=out.add_stream("flac",rate=cc.sample_rate)
            ost.layout=cc.layout; ost.format=fmt
            rs=av.AudioResampler(format=fmt,layout=cc.layout,rate=cc.sample_rate)
            for frame in inp.decode(ist):
                for f in rs.resample(frame):
                    for p in ost.encode(f): out.mux(p)
                data=sink.drain()
                if data: yield data
            for f in rs.resample(None):
                for p in ost.encode(f): out.mux(p)
            for p in ost.encode(None): out.mux(p)
        finally:
            out.close()
        data=sink.drain()
        if data: yield data
    finally:
        inp.close()

def _download(url):
    """Fallback for servers without HTTP range support (ffmpeg needs to jump
    around in .m4a files): fetch the whole file to a temp file first."""
    import requests
    fd,path=tempfile.mkstemp(prefix="flou-",suffix=".audio")
    try:
        with os.fdopen(fd,"wb") as f, requests.get(url,stream=True,timeout=15) as r:
            r.raise_for_status()
            for chunk in r.iter_content(256*1024): f.write(chunk)
    except Exception:
        os.unlink(path); raise
    return path

@router.get("/api/transcode")
def transcode(url:str):
    """Streams the audio at `url` (a track resource from the media server)
    re-encoded as FLAC, for local playback of formats the web engine can't
    play itself."""
    if urlparse(url).scheme not in ("http","https"):
        raise HTTPException(400,"Only http(s) sources can be transcoded")
    try:
        import av
    except ImportError:
        raise HTTPException(501,"Transcoding isn't available (PyAV is not installed)")
    def gen():
        sent=False
        try:
            for chunk in _flac_chunks(av,url,{"protocol_whitelist":"http,https,tcp,tls"}):
                sent=True; yield chunk
            return
        except av.error.FFmpegError:
            if sent: return  # stream already under way; nothing sensible left to do
        path=_download(url)
        try:
            yield from _flac_chunks(av,path,{"protocol_whitelist":"file"})
        finally:
            os.unlink(path)
    # Produce the first chunk before answering, so an unreachable or
    # undecodable source is reported as an error instead of an empty stream.
    chunks=gen()
    try:
        first=next(chunks,b"")
    except Exception as e:
        raise HTTPException(502,f"Could not transcode this track: {e}")
    def stream():
        yield first
        yield from chunks
    return StreamingResponse(stream(),media_type="audio/flac",headers={"Cache-Control":"no-store"})
