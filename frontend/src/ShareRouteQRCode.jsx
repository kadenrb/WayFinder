import React, { useMemo, useState } from "react";
import QRCode from "qrcode.react";

export default function ShareRouteQRCode({ shareUrl, hasRoute }) {
  const [open, setOpen] = useState(false);
  const url = useMemo(() => shareUrl || "", [shareUrl]);

  const disabled = !hasRoute || !url;

  return (
    <div className="mt-2">
      <button
        className="btn btn-outline-info btn-sm"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Hide QR" : "Share to phone"}
      </button>
      {open && url && (
        <div className="mt-2 p-2 bg-dark rounded-3 d-inline-block">
          <div className="text-white small mb-2">
            Scan to load this route on your phone
          </div>
          <QRCode value={url} size={152} bgColor="#0d1117" fgColor="#e8f6ff" />
          <div className="text-muted small mt-2" style={{ maxWidth: 180 }}>
            {url}
          </div>
        </div>
      )}
      {disabled && (
        <div className="text-muted small mt-1">
          Build a route first to share it.
        </div>
      )}
    </div>
  );
}
