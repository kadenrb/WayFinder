// share route QR code component
// provides a qr code for sharing a route URL 
// only enabled if a route exists and a share URL is provided
import React, { useMemo, useState } from "react";
import QRCode from "qrcode.react";

export default function ShareRouteQRCode({ shareUrl, hasRoute }) {
  // Local state to control whether QR code is visible
  const [open, setOpen] = useState(false);
  // Memoized URL — updates only if shareUrl prop changes
  const url = useMemo(() => shareUrl || "", [shareUrl]);
  // Disable button if no route exists or URL is empty
  const disabled = !hasRoute || !url;

  return (
    <div className="mt-2">
      {/* Button toggles QR code visibility */}
      <button
        className="btn btn-outline-info btn-sm mt-3"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <i class="bi bi-qr-code-scan text-white fs-1"></i>
      </button>
      {/* QR code display — only shown if open and URL exists */}
      {open && url && (
        <div className="p-3 bg-dark mt-2 d-flex justify-content-center rounded-3">
          <QRCode value={url} size={152} bgColor="#0d1117" fgColor="#e8f6ff" />
        </div>
      )}
      {/* Display status text depending on whether route exists */}
      {disabled ? (
        <div className="text-card mt-1 fst-italic slogan">Make a route</div>
      ) : (
        <div className="text-card mt-1 fst-italic slogan">Route ready</div>
      )}
    </div>
  );
}
