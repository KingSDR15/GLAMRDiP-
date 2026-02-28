document.addEventListener("DOMContentLoaded", () => {
  // ----------------- CONFIG -----------------
  const PAGE_LOAD_FALLBACK_MS = 9000;   // if load never fires, hide loader after this
  const HIDE_DELAY_AFTER_LOAD = 900;    // small delay after load for smooth fade
  const PROCESSING_MIN_MS = 600;        // ensure processing overlay visible briefly
  // ------------------------------------------

  // DOM refs (may be null if not present)
  const pageLoader = document.getElementById("loader");
  const mainContent = document.getElementById("mainContent");

  // Create a processing overlay (used during heavy work) if not present
  let processingOverlay = document.getElementById("processingOverlay");
  function ensureProcessingOverlay() {
    if (processingOverlay) return processingOverlay;
    processingOverlay = document.createElement("div");
    processingOverlay.id = "processingOverlay";
    processingOverlay.setAttribute("role", "status");
    processingOverlay.setAttribute("aria-live", "polite");
    Object.assign(processingOverlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "999999",
      display: "none",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(0,0,0,0.48)",
      color: "#fff",
      padding: "18px",
      boxSizing: "border-box",
    });
    processingOverlay.innerHTML = `
      <div style="max-width:720px;width:90%;text-align:center">
        <div style="display:flex;gap:12px;align-items:center;justify-content:center">
          <div style="width:44px;height:44px;border-radius:50%;border:4px solid rgba(255,255,255,0.18);border-top-color:#fff;animation:appspin 1s linear infinite"></div>
          <div style="text-align:left">
            <div id="processingTitle" style="font-weight:700;font-size:16px">Processing…</div>
            <div id="processingMsg" style="font-size:13px;opacity:0.95;margin-top:6px">Please wait while we prepare your PDF and email.</div>
          </div>
        </div>
      </div>
      <style>
        @keyframes appspin { to { transform: rotate(360deg); } }
      </style>
    `;
    document.body.appendChild(processingOverlay);
    return processingOverlay;
  }

  function showProcessing(message) {
    const ov = ensureProcessingOverlay();
    const title = document.getElementById("processingTitle");
    const msg = document.getElementById("processingMsg");
    if (title) title.textContent = "Processing…";
    if (msg) msg.textContent = message || "Preparing your submission — this may take a few seconds.";
    ov.style.display = "flex";
    // ensure main content not clickable
    if (mainContent) mainContent.setAttribute("aria-hidden","true");
    document.body.classList.add("processing-active");
  }

  function hideProcessing() {
    if (!processingOverlay) return;
    processingOverlay.style.display = "none";
    if (mainContent) mainContent.removeAttribute("aria-hidden");
    document.body.classList.remove("processing-active");
  }

  // Page loader behavior: show loader initially, hide after window.load + delay,
  // or hide after fallback timeout.
  (function handlePageLoader() {
    // if loader exists, ensure it's visible initially and main hidden
    if (pageLoader) {
      pageLoader.style.display = "";
      if (mainContent) mainContent.style.display = "none";
    } else {
      // no #loader element: ensure mainContent hidden briefly until load or fallback
      if (mainContent) mainContent.style.display = "none";
    }

    let loaded = false;
    function finalizeHideLoader() {
      // fade/hide loader and reveal main
      try {
        if (pageLoader) {
          // graceful hide
          pageLoader.style.transition = "opacity 360ms ease, visibility 360ms ease";
          pageLoader.style.opacity = "0";
          setTimeout(() => {
            if (pageLoader && pageLoader.parentNode) pageLoader.parentNode.removeChild(pageLoader);
          }, 420);
        }
      } catch(e){ /* ignore */ }

      if (mainContent) mainContent.style.display = "block";
      loaded = true;
    }

    function onLoad() {
      setTimeout(finalizeHideLoader, HIDE_DELAY_AFTER_LOAD);
      window.removeEventListener("load", onLoad);
    }
    // attach
    window.addEventListener("load", onLoad);

    // fallback just in case load doesn't fire (blocked by some resource)
    setTimeout(() => {
      if (!loaded) {
        finalizeHideLoader();
        console.warn("[loader] fallback hide triggered");
      }
    }, PAGE_LOAD_FALLBACK_MS);
  })();

  // ---------- Begin original form handling (improved) ----------
  const form = document.getElementById("collabForm");
  if (!form) {
    console.error("collabForm not found in DOM");
    return;
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    // prevent double submit
    const submitButtons = form.querySelectorAll('[type="submit"], button[data-submit-button]');
    submitButtons.forEach(b => b.disabled = true);

    // show processing overlay
    showProcessing("Generating PDF — do not close this window.");

    // ensure overlay visible for at least a short time
    const startedAt = Date.now();
    try {
      console.log("Submit clicked — preparing PDF...");

      // collect form data (safe)
      const formData = new FormData(form);

      // Build a plain object of non-file fields for email body
      const allFields = {};
      for (const [key, value] of formData.entries()) {
        // skip files here; we'll gather filenames separately
        if (value instanceof File) continue;
        allFields[key] = (value || "").toString().trim();
      }

      // Extract commonly used fields (for backward compatibility/display)
      const name = allFields.name || "";
      const email = allFields.email || "";
      const insta = allFields.insta || "";
      const phone = allFields.phone || "";
      const address = allFields.address || "";
      const tiktok = allFields.tiktok || "";
      const audience = allFields.audience || "";
      const mediakit = allFields.mediakit || "";
      const typical_rate = allFields.typical_rate || "";
      const country = allFields.country || "";

      // payment: support multiple field names (fallback to hidden)
      const payment =
        allFields.payment ||
        allFields.paymentMethod ||
        allFields.paymentMethodHidden ||
        allFields.payment_method ||
        "Not specified";

      // collect image files (1..30) AND filenames list for the email body
      const imageFiles = [];
      const imageNames = [];
      for (let i = 1; i <= 30; i++) {
        const file = formData.get(`img${i}`);
        if (file && file.name && file.type && file.type.startsWith("image/")) {
          imageFiles.push(file);
          imageNames.push(file.name);
        }
      }
      console.log("Images found:", imageFiles.length);

      // Ensure jsPDF present (robust detection)
      const jsPDFConstructor = (window.jspdf && (window.jspdf.jsPDF || window.jspdf.default || window.jspdf)) || null;
      if (!jsPDFConstructor) {
        // FIX: ensure UI cleaned up before returning so overlay isn't left on screen
        hideProcessing();
        submitButtons.forEach(b => b.disabled = false);
        console.error("jsPDF not loaded or accessible as window.jspdf");
        alert("Error");
        return;
      }

      // create doc
      const doc = new jsPDFConstructor();

      // helpers ------------------------------------------------
      function trimOr(value, fallback = "") {
        return (value || "").toString().trim() || fallback;
      }

      // Resize image client-side to max dimension (keeps PDF small)
      function readAndResizeImage(file, maxSize = 1000) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = (err) => {
            console.warn("FileReader error", err);
            resolve(null);
          };
          reader.onload = () => {
            const img = new Image();
            img.onload = () => {
              try {
                const canvas = document.createElement("canvas");
                let { width, height } = img;
                const ratio = width / height;
                if (width > maxSize || height > maxSize) {
                  if (ratio > 1) {
                    width = maxSize;
                    height = Math.round(maxSize / ratio);
                  } else {
                    height = maxSize;
                    width = Math.round(maxSize * ratio);
                  }
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0, width, height);
                // use JPEG to reduce size; keep quality reasonable
                const mime = (file.type === "image/png") ? "image/png" : "image/jpeg";
                const dataUrl = canvas.toDataURL(mime, 0.85);
                resolve(dataUrl);
              } catch (err) {
                // fallback to original dataURL
                console.warn("resize error, falling back to original dataURL", err);
                resolve(reader.result);
              }
            };
            img.onerror = () => {
              // cannot load image; resolve with original data url
              console.warn("image load error; using raw data url");
              resolve(reader.result);
            };
            img.src = reader.result;
          };
          reader.readAsDataURL(file);
        });
      }

      // detect image mime from dataURL
      function detectImageType(dataUrl) {
        if (!dataUrl || typeof dataUrl !== "string") return "JPEG";
        if (dataUrl.startsWith("data:image/png")) return "PNG";
        if (dataUrl.startsWith("data:image/jpeg") || dataUrl.startsWith("data:image/jpg")) return "JPEG";
        if (dataUrl.startsWith("data:image/webp")) return "WEBP";
        return "JPEG";
      }

      // build PDF ------------------------------------------------
      let y = 20;
      const lineHeight = 8;

      doc.setFontSize(16);
      doc.setFont("helvetica", "bold");
      doc.text("COLLABORATION AGREEMENT", 105, y, { align: "center" });
      y += lineHeight * 2;

      doc.setFontSize(12);
      doc.setFont("helvetica", "normal");
      // replace brand name as needed
      doc.text("GLAMRDiP", 20, y); y += lineHeight;


      doc.setFont("helvetica", "bold");
      doc.text("Influencer Details", 20, y); y += lineHeight;
      doc.setFont("helvetica", "normal");
      doc.text(`Full Name: ${trimOr(name)}`, 20, y); y += lineHeight;
      doc.text(`Email Address: ${trimOr(email)}`, 20, y); y += lineHeight;
      doc.text(`Instagram Handle: ${trimOr(insta)}`, 20, y); y += lineHeight;
      // NEW: write TikTok
      doc.text(`TikTok Handle: ${trimOr(tiktok)}`, 20, y); y += lineHeight;
      // NEW: other handles
      doc.text(`Other Handles: ${trimOr(audience)}`, 20, y); y += lineHeight;
      // NEW: portfolio / mediakit
      doc.text(`Portfolio / Media Kit: ${trimOr(mediakit)}`, 20, y); y += lineHeight;
      // NEW: typical rate
      doc.text(`Typical Rate / Budget: ${trimOr(typical_rate)}`, 20, y); y += lineHeight;
      // NEW: country / state
      doc.text(`Country / State: ${trimOr(country)}`, 20, y); y += lineHeight;

      doc.text(`Phone Number: ${trimOr(phone)}`, 20, y); y += lineHeight;
      doc.text(`Delivery Address: ${trimOr(address)}`, 20, y); y += lineHeight;

      // Payment
      doc.setFont("helvetica", "bold");
      doc.text("Payment Method:", 20, y);

      doc.setFont("helvetica", "normal");
      // print payment neatly to the right, with wrapping if long
      doc.text(payment, 72, y, { maxWidth: 90 });

      y += lineHeight * 1.6;


      doc.setFont("helvetica", "bold");
      doc.text("Selected Product Screenshots:", 20, y); y += lineHeight;

      // Add each image after resizing
      for (let i = 0; i < imageFiles.length; i++) {
        const file = imageFiles[i];
        console.log(`Processing image ${i+1}/${imageFiles.length}`, file && file.name);
        const dataUrl = await readAndResizeImage(file, 1000); // resized DataURL
        if (!dataUrl) {
          console.warn("image dataUrl missing, skipping item", file && file.name);
          continue;
        }
        if (y > 230) { doc.addPage(); y = 20; }

        doc.setFont("helvetica", "normal");
        doc.text(`Item ${i + 1}: ${file.name}`, 25, y);
        y += 4;

        const imgType = detectImageType(dataUrl);
        try {
          // place 80x80 images; adjust if need
          doc.addImage(dataUrl, imgType, 25, y, 80, 80);
        } catch (err) {
          console.warn("addImage failed for item", i+1, err);
          // try fallback without specifying type
          try { doc.addImage(dataUrl, 25, y, 80, 80); } catch (err2) {
            console.warn("fallback addImage also failed", err2);
          }
        }
        y += 86;
      }

      y += lineHeight;

      // Force Invoice Summary onto its own page
      doc.addPage();
      y = 20;

      doc.setFont("helvetica", "bold");
      doc.text("Invoice Summary", 20, y); y += lineHeight;
      doc.setFont("helvetica", "normal");
      doc.text(`Items Provided (${imageFiles.length}): $0`, 25, y); y += lineHeight;
      doc.text(`Payment Method: ${payment}`, 25, y); y += lineHeight;
      doc.text("Tax Fee: -", 25, y); y += lineHeight;
      doc.text("------------------------------------------------------", 25, y); y += lineHeight;
      doc.setFont("helvetica", "bold");
      doc.text("Total Payable: 2,000.00 USD", 25, y); y += lineHeight * 2;

      doc.setFontSize(10);
      doc.setFont("helvetica", "italic");
      doc.text(
        "By submitting this agreement, the influencer agrees to promote the brand’s products under the stated collaboration terms and conditions.",
        20, y,
        { maxWidth: 170 }
      );

      const safeName = (name || "influencer").replace(/[^a-z0-9]/gi, "_").toLowerCase();
      const fileName = `collaboration_agreement_${safeName}.pdf`;

      // Create a Blob and trigger download
      try {
        const blob = doc.output("blob");
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        // Append to DOM to support Firefox
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          URL.revokeObjectURL(url);
          if (a && a.parentNode) a.parentNode.removeChild(a);

          // build payload for afterDownloadSuccess: include all fields and filenames
          afterDownloadSuccess({
            allFields,                 // full key:value map of non-file fields
            imageNames,                // array of uploaded image file names
            pdfFileName: fileName      // the generated PDF filename (user must attach this)
          });
        }, 300); // small delay to ensure browser started download
      } catch (err) {
        console.error("Failed creating blob/download:", err);
        alert("Failed to generate file for download. See console for details.");
      }

    } catch (err) {
      console.error("Error during form submit/pdf generation:", err);
      alert("An error occurred while generating the PDF. Check console for details.");
    } finally {
      // Ensure processing overlay is visible a minimum time for UX smoothness
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, PROCESSING_MIN_MS - elapsed);
      setTimeout(() => {
        hideProcessing();
        // re-enable submit buttons
        const submitButtons = form.querySelectorAll('[type="submit"], button[data-submit-button]');
        submitButtons.forEach(b => b.disabled = false);
      }, remaining);
    }
  });

  // Called after download initiated — compose full mail body and open mail client
  function afterDownloadSuccess(payload) {
    try {
      // show success UI
      form.style.display = "none";
      const success = document.getElementById("success");
      if (success) success.style.display = "block";

      // get email link element if present (for manual click)
      const emailLinkEl = document.getElementById("emailLink");

      // Build a friendly subject
      const name = (payload.allFields && payload.allFields.name) || "";
      const subject = `Collaboration Submission — ${name || "New Influencer"}`;

      // Build a full body including every field the user filled
      const bodyLines = [];
      bodyLines.push(`Hello,`);
      bodyLines.push("");
      bodyLines.push(`Please find my collaboration submission below. I have downloaded the signed PDF and will attach it to this email before sending.`);
      bodyLines.push("");
      bodyLines.push("=== SUBMISSION DETAILS ===");

      // iterate fields in a stable order: common fields first, then the rest sorted
      const commonOrder = ["name","email","insta","tiktok","audience","mediakit","typical_rate","country","phone","address","payment","paymentMethod","paymentMethodHidden"];
      const used = new Set();

      for (const key of commonOrder) {
        if (payload.allFields && Object.prototype.hasOwnProperty.call(payload.allFields, key)) {
          bodyLines.push(`• ${prettyKey(key)}: ${payload.allFields[key] || ""}`);
          used.add(key);
        }
      }

      // append remaining fields alphabetically
      if (payload.allFields) {
        const rest = Object.keys(payload.allFields).filter(k => !used.has(k)).sort();
        for (const k of rest) {
          bodyLines.push(`• ${prettyKey(k)}: ${payload.allFields[k] || ""}`);
        }
      }

      // uploaded image filenames (if any)
      bodyLines.push("");
      bodyLines.push("Uploaded item screenshots:");
      if (payload.imageNames && payload.imageNames.length) {
        for (let i = 0; i < payload.imageNames.length; i++) {
          bodyLines.push(`• ${payload.imageNames[i]}`);
        }
      } else {
        bodyLines.push("• (none uploaded)");
      }

      bodyLines.push("");
      bodyLines.push(`Downloaded signed PDF filename: ${payload.pdfFileName}`);
      bodyLines.push("");
      bodyLines.push("Please attach the downloaded PDF to this email before sending. If you have any questions, reply to this message.");
      bodyLines.push("");
      bodyLines.push("Kind regards,");
      bodyLines.push(`${name || ""}`);

      const body = bodyLines.join("\n");

      // Create mailto (encode)
      const to = "glamrdip.collaboration@gmail.com";
      const maxMailtoLength = 1900; // conservative limit (varies by client)
      const encodedSubject = encodeURIComponent(subject);
      let encodedBody = encodeURIComponent(body);

      // If mailto too long, shorten body but keep essential info
      if ((`mailto:${to}?subject=${encodedSubject}&body=${encodedBody}`).length > maxMailtoLength) {
        const shortBodyLines = [
          `Hello,`,
          ``,
          `Submission from ${name || "influencer"} — some details below. Full details available in the downloaded PDF (please attach).`,
          ``,
          `Email: ${payload.allFields?.email || ""}`,
          `Instagram: ${payload.allFields?.insta || ""}`,
          `TikTok: ${payload.allFields?.tiktok || ""}`,
          `Downloaded PDF: ${payload.pdfFileName}`,
          ``,
          `Please attach the PDF and send.`
        ];
        encodedBody = encodeURIComponent(shortBodyLines.join("\n"));
      }

      const mailtoHref = `mailto:${to}?subject=${encodedSubject}&body=${encodedBody}`;

      // set emailLink href for manual clicking
      if (emailLinkEl) {
        emailLinkEl.href = mailtoHref;
        emailLinkEl.innerHTML = `<i class="fas fa-envelope"></i>Email`;
        // add helper that reminds to attach file
        emailLinkEl.addEventListener("click", () => {
          setTimeout(() => {
            alert(`Reminder: attach the downloaded file (${payload.pdfFileName}) to this email before sending.`);
          }, 250);
        }, { once: true });
      }

      // Auto-open user's default mail client (user can cancel/modify message)
      // Note: this will open the mail client with prefilled subject/body; attachments are not supported by mailto.
      try {
        window.location.href = mailtoHref;
      } catch (err) {
        console.warn("Auto-opening mail client failed; user can click the email link manually.", err);
      }

    } catch (err) {
      console.warn("afterDownloadSuccess error:", err);
    }
  }

  // small utility to prettify field keys for human reading
  function prettyKey(k) {
    if (!k) return "";
    // common mapping
    const map = {
      name: "Full name",
      email: "Email",
      insta: "Instagram",
      tiktok: "TikTok",
      audience: "Other handles",
      mediakit: "Portfolio / Media Kit",
      typical_rate: "Typical rate",
      country: "Country / State",
      phone: "Phone",
      address: "Address",
      payment: "Payment",
      paymentMethod: "Payment method"
    };
    return map[k] || k.replace(/[_-]/g, " ").replace(/\b\w/g, s => s.toUpperCase());
  }

  // small utility to read file as data URL (not used by resizing path but kept)
  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = (e) => reject(e);
      reader.onload = (e) => resolve(e.target.result);
      reader.readAsDataURL(file);
    });
  }

  // ---------- end main DOMContentLoaded ----------
}); // DOMContentLoaded end

// payment sync + keyboard accessibility (IIFE)
(function () {
  const hidden = document.getElementById('paymentMethodHidden');
  const radios = document.querySelectorAll('input[name="pm"]');

  if (!radios || radios.length === 0) {
    // nothing to sync — maybe user uses a select instead
    return;
  }

  radios.forEach(r => {
    r.addEventListener('change', () => {
      if (r.checked && hidden) hidden.value = r.value;
      // update ARIA on labels
      radios.forEach(rr => {
        const lbl = document.querySelector(`label[for="${rr.id}"]`);
        if (lbl) lbl.setAttribute('aria-checked', rr.checked ? 'true' : 'false');
      });
    });

    // support label keyboard activation
    const lbl = document.querySelector(`label[for="${r.id}"]`);
    if (lbl) {
      lbl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          r.checked = true;
          r.dispatchEvent(new Event('change', { bubbles: true }));
          lbl.focus();
        }
      });
    }
  });

  // initialize hidden value
  const init = document.querySelector('input[name="pm"]:checked');
  if (init && hidden) hidden.value = init.value;
})();