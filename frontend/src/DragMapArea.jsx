/*
  DragMapArea – “just drop the damn map here” UX:
  - This is the little file-drop widget that lets you feed a floor map into the tool.
  - It supports:
      • Drag-and-drop from the file system.
      • Clicking to open a normal file chooser.
      • Live preview of the image you picked so you can sanity check it.
      • Passing the selected image URL + file object up via onImageSelected.
      • Saving the blob back out either with the File System Access API
        (on modern Chromium) or a classic “download this image” fallback.
  - The parent can treat this like a black box: user interacts → you get a URL
    and file metadata, and you never have to care how it was picked.
*/

import React, { useRef, useState } from "react";

function DragMapArea({ onImageSelected }) {
  // Local state:
  // - previewUrl: what we show in the dropzone once a file is picked.
  // - dragOver: visual flag for when a file is being dragged over the area.
  // - blob: the actual File/Blob object we’re holding (for saving later).
  // - fileName: name used for suggested saves/downloads.
  // - status: tiny status line (file size, save confirmation, errors, etc.).
  const [previewUrl, setPreviewUrl] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [blob, setBlob] = useState(null);
  const [fileName, setFileName] = useState("map.png");
  const [status, setStatus] = useState("");
  const fileInputRef = useRef(null);

  /*
    handleFiles – the single “please deal with this new file” entry point:
    - Accepts a FileList (from drag-drop or <input type="file" />).
    - Validates that we actually got a file and that it’s an image.
    - Stores the blob and derives a preview URL using URL.createObjectURL.
      (We also revoke the old URL to avoid leaking memory.)
    - Updates the status line with a cute little size read-out in KB.
    - If the parent gave us onImageSelected, we fire it with:
        - The preview URL (useful for immediate display in parent)
        - A metadata object containing the File and its name.
    - Errors from onImageSelected are swallowed so a misbehaving parent
      doesn’t break the uploader UI.
  */
  const handleFiles = (files) => {
    if (!files || !files.length) return;
    const f = files[0];
    if (!f.type.startsWith("image/")) {
      setStatus("That file is not an image.");
      return;
    }

    setBlob(f);
    setFileName(f.name || "map.png");

    const url = URL.createObjectURL(f);
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return url;
    });

    setStatus(`${f.name} (${(f.size / 1024).toFixed(1)} KB)`);

    try {
      onImageSelected && onImageSelected(url, { file: f, name: f.name });
    } catch {
      // If the parent explodes here, we just quietly ignore it.
    }
  };

  /*
    Drag-and-drop event handlers – just enough ceremony to feel native:
    - All of these:
        • preventDefault + stopPropagation to keep the browser from
          doing its own “open this file in a new tab” nonsense.
        • flip the dragOver flag so we can style the zone accordingly.
    - onDrop hands the FileList to handleFiles once the user releases.
  */
  const onDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
  };

  const onDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  const onDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  const onDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  /*
    onPick – click-to-choose handler:
    - Triggered when the hidden <input type="file" /> changes.
    - Forwards the FileList to handleFiles.
    - Resets e.target.value so that picking the same file twice in a row
      still fires change (some browsers otherwise ignore it).
  */
  const onPick = (e) => {
    handleFiles(e.target.files);
    e.target.value = ""; // allow re-selecting same file
  };

  /*
    saveWithFileSystemAccess – “fancy” save via File System Access API:
    - Only works on browsers that implement window.showSaveFilePicker.
    - Opens a real save dialog where you can drop this straight into your
      project folder (e.g., public/floors/map.png).
    - Writes the current blob and closes the handle.
    - Updates the status line with the saved file name.
  */
  async function saveWithFileSystemAccess() {
    const suggested = fileName || "map.png";
    const ext = suggested.includes(".") ? suggested.split(".").pop() : "png";
    const mime = blob?.type || "image/png";

    const handle = await window.showSaveFilePicker({
      suggestedName: suggested,
      types: [{ description: "Image", accept: { [mime]: ["." + ext] } }],
    });

    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();

    setStatus(`Saved: ${handle.name}`);
  }

  /*
    saveWithDownloadFallback – old-school “just download the file” path:
    - Creates a temporary object URL for the blob.
    - Creates an <a> element, triggers click(), and then cleans up.
    - This is what you get on Safari / Firefox / older Chrome, etc.
    - From the user’s perspective, it’s just “browser downloaded my map”.
  */
  function saveWithDownloadFallback() {
    if (!blob) return;

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName || "map.png";

    document.body.appendChild(a);
    a.click();
    a.remove();

    setStatus(`Download started: ${a.download}`);

    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  /*
    onSave – smart entry point for saving:
    - If we don’t have a blob yet, we nudge the user to upload something.
    - If the browser exposes showSaveFilePicker, we use that first.
    - If that errors (or isn’t available), we automatically fall back to
      the download-based approach so the user still gets a file.
    - AbortError is treated as “user cancelled the dialog”, not a real error.
  */
  const onSave = async () => {
    if (!blob) {
      setStatus("Add an image first.");
      return;
    }

    try {
      if (
        "showSaveFilePicker" in window &&
        typeof window.showSaveFilePicker === "function"
      ) {
        await saveWithFileSystemAccess();
      } else {
        saveWithDownloadFallback();
      }
    } catch (err) {
      if (err?.name === "AbortError") return;
      console.error(err);
      setStatus("Couldn’t save. Using download fallback…");
      saveWithDownloadFallback();
    }
  };

  /*
    Render – dropzone + actions:
    - The main box:
        • clickable so keyboard/mouse users can open the file dialog.
        • wired to all the drag events for “drag a file over this box” UX.
        • toggles CSS classes based on dragOver and whether we have an image.
    - Helper text shows when there’s no image yet.
    - Once we have a previewUrl, the map image is drawn in the box.
    - Below the box we show:
        • A “Save image…” button (disabled until a blob exists).
        • A slim status line for feedback (aria-live for screen readers).
  */
  return (
    <section>
      <div
        className={`map-dropzone ${dragOver ? "is-dragover" : ""} ${previewUrl ? "has-image" : ""
          }`}
        onClick={() => fileInputRef.current?.click()}
        onDrop={onDrop}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        role="button"
        aria-label="Drag map.png here or click to choose"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ")
            fileInputRef.current?.click();
        }}
      >
        {!previewUrl && (
          <div className="map-dropzone__helper">
            <div className="map-dropzone__dashes">
              ────────────────────────────
            </div>
            <div className="map-dropzone__text">
              drag <strong>map.png</strong> here
            </div>
            <div className="map-dropzone__dashes">
              ────────────────────────────
            </div>
            <div className="map-dropzone__hint">
              (or click to choose an image)
            </div>
          </div>
        )}

        {previewUrl && (
          <img
            className="map-dropzone__img"
            src={previewUrl}
            alt="Map preview"
          />
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={onPick}
        />
      </div>

      <div className="map-actions">
        <button
          className="btn btn-outline-primary"
          onClick={onSave}
          disabled={!blob}
        >
          Save image…
        </button>
        <span className="map-status text-card" aria-live="polite">
          {status}
        </span>
      </div>
    </section>
  );
}

export default DragMapArea;
