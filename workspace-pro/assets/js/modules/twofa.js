import { esc, toast, copyText, downloadText } from '../utils.js';

const host = () => document.getElementById('module-twofa');

let current = {
  secret: '',
  algorithm: 'SHA1',
  digits: 6,
  period: 30,
  issuer: '',
  account: ''
};

let accounts = [];
let otpTimer = null;
let qrCanvas = null;
let pasteBound = false;

/* =========================================================
   HELPERS
========================================================= */

const $ = id => document.getElementById(id);

function isTwoFAActive() {
  const el = host();
  return !!el && el.classList.contains('active');
}

function normalizeBase32(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/-/g, '')
    .replace(/=/g, '');
}

function bytesToBase32(buffer) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

  let bits = 0;
  let value = 0;
  let out = '';

  for (const b of buffer) {
    value = (value << 8) | b;
    bits += 8;

    while (bits >= 5) {
      out += alphabet[
        (value >>> (bits - 5)) & 31
      ];

      bits -= 5;
    }
  }

  if (bits > 0) {
    out += alphabet[
      (value << (5 - bits)) & 31
    ];
  }

  return out;
}

function base64UrlToBytes(value) {
  let s = String(value || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  while (s.length % 4) {
    s += '=';
  }

  const raw = atob(s);

  return Uint8Array.from(
    raw,
    c => c.charCodeAt(0)
  );
}

function showStatus(
  message,
  type = 'info'
) {
  const el = $('faStatus');

  if (!el) {
    return;
  }

  const cls = {
    success: 'alert-success',
    danger: 'alert-danger',
    warning: 'alert-warning',
    info: 'alert-info'
  }[type] || 'alert-info';

  el.className =
    `alert ${cls} py-2 px-3 mt-3 mb-0`;

  el.textContent = message;

  el.classList.remove('d-none');
}

function clearStatus() {
  const el = $('faStatus');

  if (!el) {
    return;
  }

  el.classList.add('d-none');
  el.textContent = '';
}

function safeClipboardImage(event) {
  const dt = event.clipboardData;

  if (!dt) {
    return null;
  }

  /*
   * Cách tương thích rộng nhất:
   * chỉ cần clipboard item có MIME image/*
   */
  if (
    dt.items &&
    dt.items.length
  ) {
    for (const item of dt.items) {
      const type =
        String(item.type || '')
          .toLowerCase();

      if (
        type.startsWith('image/')
      ) {
        const file =
          item.getAsFile();

        if (file) {
          return file;
        }
      }
    }
  }

  /*
   * Fallback cho Edge / Windows
   */
  if (
    dt.files &&
    dt.files.length
  ) {
    for (const file of dt.files) {
      const type =
        String(file.type || '')
          .toLowerCase();

      if (
        type.startsWith('image/')
      ) {
        return file;
      }
    }
  }

  return null;
}

/* =========================================================
   OTP AUTH
========================================================= */

function parseOTPAuth(value) {
  value =
    String(value || '')
      .trim();

  if (!value) {
    throw new Error(
      'Chưa có dữ liệu.'
    );
  }

  if (
    typeof OTPAuth === 'undefined'
  ) {
    throw new Error(
      'Thư viện OTPAuth chưa tải được.'
    );
  }

  if (
    value
      .toLowerCase()
      .startsWith('otpauth://')
  ) {
    const totp =
      OTPAuth.URI.parse(value);

    current = {
      secret:
        normalizeBase32(
          totp.secret?.base32 ||
          (
            totp.secret?.bytes
              ? bytesToBase32(
                  totp.secret.bytes
                )
              : ''
          )
        ),

      algorithm:
        String(
          totp.algorithm || 'SHA1'
        ).toUpperCase(),

      digits:
        Number(
          totp.digits || 6
        ),

      period:
        Number(
          totp.period || 30
        ),

      issuer:
        totp.issuer || '',

      account:
        totp.name || ''
    };
  } else {
    current = {
      secret:
        normalizeBase32(value),

      algorithm:
        'SHA1',

      digits:
        6,

      period:
        30,

      issuer:
        '',

      account:
        ''
    };
  }

  if (!current.secret) {
    throw new Error(
      'Không tìm thấy Secret.'
    );
  }

  if (
    !/^[A-Z2-7]+$/
      .test(current.secret)
  ) {
    throw new Error(
      'Secret không phải Base32 hợp lệ.'
    );
  }

  return current;
}

function makeOtpAuth(acc) {
  const label =
    encodeURIComponent(
      (
        acc.issuer
          ? `${acc.issuer}:`
          : ''
      ) +
      (
        acc.account ||
        '2FA'
      )
    );

  return (
    `otpauth://totp/${label}` +
    `?secret=${encodeURIComponent(
      acc.secret
    )}` +
    `&issuer=${encodeURIComponent(
      acc.issuer || '2FA'
    )}` +
    `&algorithm=${encodeURIComponent(
      acc.algorithm || 'SHA1'
    )}` +
    `&digits=${encodeURIComponent(
      acc.digits || 6
    )}` +
    `&period=${encodeURIComponent(
      acc.period || 30
    )}`
  );
}

/* =========================================================
   TOTP
========================================================= */

async function generateTOTP(
  acc = current
) {
  const secret =
    normalizeBase32(
      acc.secret
    );

  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

  let bits = '';

  const bytes = [];

  for (const c of secret) {
    const n =
      alphabet.indexOf(c);

    if (n < 0) {
      throw new Error(
        'Secret Base32 không hợp lệ.'
      );
    }

    bits +=
      n
        .toString(2)
        .padStart(5, '0');
  }

  for (
    let i = 0;
    i + 8 <= bits.length;
    i += 8
  ) {
    bytes.push(
      parseInt(
        bits.slice(
          i,
          i + 8
        ),
        2
      )
    );
  }

  const period =
    Number(acc.period) || 30;

  const counter =
    Math.floor(
      Date.now() /
      1000 /
      period
    );

  const counterBytes =
    new Uint8Array(8);

  let n = counter;

  for (
    let i = 7;
    i >= 0;
    i--
  ) {
    counterBytes[i] =
      n & 255;

    n =
      Math.floor(
        n / 256
      );
  }

  const algorithm =
    String(
      acc.algorithm || 'SHA1'
    ).toUpperCase();

  const hashName =
    algorithm === 'SHA512'
      ? 'SHA-512'
      : algorithm === 'SHA256'
        ? 'SHA-256'
        : 'SHA-1';

  const key =
    await crypto.subtle.importKey(
      'raw',
      new Uint8Array(bytes),
      {
        name: 'HMAC',
        hash: hashName
      },
      false,
      ['sign']
    );

  const hash =
    new Uint8Array(
      await crypto.subtle.sign(
        'HMAC',
        key,
        counterBytes
      )
    );

  const offset =
    hash[
      hash.length - 1
    ] & 15;

  const binary = (
    (
      (
        hash[offset] & 127
      ) << 24
    ) |
    (
      (
        hash[offset + 1] &
        255
      ) << 16
    ) |
    (
      (
        hash[offset + 2] &
        255
      ) << 8
    ) |
    (
      hash[offset + 3] &
      255
    )
  ) >>> 0;

  const digits =
    Number(acc.digits) || 6;

  return String(
    binary %
    Math.pow(
      10,
      digits
    )
  ).padStart(
    digits,
    '0'
  );
}

/* =========================================================
   OTP UI
========================================================= */

function updateInfo() {
  if (!$('faAccount')) {
    return;
  }

  $('faAccount').textContent =
    current.account || '-';

  $('faIssuer').textContent =
    current.issuer || '-';

  $('faAlgo').textContent =
    `${current.algorithm} · ${current.digits} digits · ${current.period}s`;
}

async function updateMainOTP() {
  if (!current.secret) {
    return;
  }

  try {
    const code =
      await generateTOTP(
        current
      );

    const codeEl =
      $('faCode');

    const timerEl =
      $('faTimer');

    const progressEl =
      $('faProgress');

    if (!codeEl) {
      return;
    }

    const period =
      Number(
        current.period
      ) || 30;

    const now =
      Math.floor(
        Date.now() / 1000
      );

    const remaining =
      period -
      (
        now %
        period
      );

    codeEl.textContent =
      code;

    if (timerEl) {
      timerEl.textContent =
        `Mã mới sau ${remaining} giây`;
    }

    if (progressEl) {
      progressEl.style.width =
        `${
          (
            remaining /
            period
          ) * 100
        }%`;
    }
  } catch (error) {
    showStatus(
      error.message,
      'danger'
    );
  }
}

function startOTP() {
  clearInterval(
    otpTimer
  );

  updateMainOTP();

  otpTimer =
    setInterval(
      updateMainOTP,
      1000
    );
}

function resetCurrent() {
  clearInterval(
    otpTimer
  );

  otpTimer = null;

  current = {
    secret: '',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    issuer: '',
    account: ''
  };

  render();
}

/* =========================================================
   QR IMAGE READER
========================================================= */

async function fileToImageData(file) {
  if (!file) {
    throw new Error(
      'Không có ảnh.'
    );
  }

  /*
   * createImageBitmap
   * chạy rất tốt với ảnh từ clipboard
   */
  if (
    'createImageBitmap' in window
  ) {
    try {
      const bitmap =
        await createImageBitmap(
          file
        );

      const max = 4000;

      let width =
        bitmap.width;

      let height =
        bitmap.height;

      if (
        Math.max(
          width,
          height
        ) > max
      ) {
        const scale =
          max /
          Math.max(
            width,
            height
          );

        width =
          Math.round(
            width * scale
          );

        height =
          Math.round(
            height * scale
          );
      }

      const canvas =
        document.createElement(
          'canvas'
        );

      canvas.width =
        width;

      canvas.height =
        height;

      const ctx =
        canvas.getContext(
          '2d',
          {
            willReadFrequently:
              true
          }
        );

      ctx.drawImage(
        bitmap,
        0,
        0,
        width,
        height
      );

      bitmap.close?.();

      return (
        ctx.getImageData(
          0,
          0,
          width,
          height
        )
      );
    } catch {
      // fallback bên dưới
    }
  }

  return await new Promise(
    (
      resolve,
      reject
    ) => {
      const reader =
        new FileReader();

      reader.onerror =
        () => {
          reject(
            new Error(
              'Không đọc được ảnh.'
            )
          );
        };

      reader.onload =
        event => {
          const img =
            new Image();

          img.onerror =
            () => {
              reject(
                new Error(
                  'Ảnh không hợp lệ.'
                )
              );
            };

          img.onload =
            () => {
              const max = 4000;

              let width =
                img.naturalWidth;

              let height =
                img.naturalHeight;

              if (
                Math.max(
                  width,
                  height
                ) > max
              ) {
                const scale =
                  max /
                  Math.max(
                    width,
                    height
                  );

                width =
                  Math.round(
                    width *
                    scale
                  );

                height =
                  Math.round(
                    height *
                    scale
                  );
              }

              const canvas =
                document.createElement(
                  'canvas'
                );

              canvas.width =
                width;

              canvas.height =
                height;

              const ctx =
                canvas.getContext(
                  '2d',
                  {
                    willReadFrequently:
                      true
                  }
                );

              ctx.drawImage(
                img,
                0,
                0,
                width,
                height
              );

              resolve(
                ctx.getImageData(
                  0,
                  0,
                  width,
                  height
                )
              );
            };

          img.src =
            event
              .target
              .result;
        };

      reader.readAsDataURL(
        file
      );
    }
  );
}

async function readQR(file) {
  try {
    if (
      typeof jsQR ===
      'undefined'
    ) {
      throw new Error(
        'Thư viện jsQR chưa tải được.'
      );
    }

    showStatus(
      'Đang đọc QR...',
      'info'
    );

    const imageData =
      await fileToImageData(
        file
      );

    const qr =
      jsQR(
        imageData.data,
        imageData.width,
        imageData.height,
        {
          inversionAttempts:
            'attemptBoth'
        }
      );

    if (!qr?.data) {
      throw new Error(
        'Không tìm thấy QR trong ảnh.'
      );
    }

    handleQRText(
      qr.data
    );

    showStatus(
      '✓ Đã đọc QR từ ảnh.',
      'success'
    );
  } catch (error) {
    showStatus(
      error.message ||
      'Không đọc được QR.',
      'danger'
    );
  }
}

function handleQRText(text) {
  text =
    String(text || '')
      .trim();

  if (
    text.startsWith(
      'otpauth-migration://'
    )
  ) {
    decodeMigration(
      text
    );

    const migrationTab =
      document.querySelector(
        '[data-bs-target="#faMigration"]'
      );

    if (migrationTab) {
      bootstrap.Tab
        .getOrCreateInstance(
          migrationTab
        )
        .show();
    }

    return;
  }

  if (
    text.startsWith(
      'otpauth://'
    )
  ) {
    parseOTPAuth(
      text
    );

    if ($('faInput')) {
      $('faInput').value =
        text;
    }

    if ($('faQrInput')) {
      $('faQrInput').value =
        text;
    }

    updateInfo();
    startOTP();

    return;
  }

  throw new Error(
    'QR không phải otpauth:// hoặc Google Authenticator Migration.'
  );
}

/* =========================================================
   PASTE
========================================================= */

function globalPasteHandler(
  event
) {
  /*
   * Chỉ xử lý khi module
   * 2FA đang mở.
   */
  if (
    !isTwoFAActive()
  ) {
    return;
  }

  /*
   * Ưu tiên ảnh clipboard.
   */
  const imageFile =
    safeClipboardImage(
      event
    );

  if (imageFile) {
    event.preventDefault();
    event.stopPropagation();

    readQR(
      imageFile
    );

    return;
  }

  /*
   * Nếu không có ảnh:
   * textarea/input vẫn paste text
   * bình thường.
   */
  const target =
    event.target;

  const isTextField =
    target instanceof
      HTMLInputElement ||
    target instanceof
      HTMLTextAreaElement ||
    target?.isContentEditable;

  if (isTextField) {
    return;
  }

  const text =
    event
      .clipboardData
      ?.getData(
        'text/plain'
      )
      ?.trim();

  if (
    text &&
    (
      text.startsWith(
        'otpauth://'
      ) ||
      text.startsWith(
        'otpauth-migration://'
      )
    )
  ) {
    event.preventDefault();

    try {
      handleQRText(
        text
      );

      showStatus(
        '✓ Đã nhận dữ liệu từ clipboard.',
        'success'
      );
    } catch (error) {
      showStatus(
        error.message,
        'danger'
      );
    }
  }
}

/* =========================================================
   QR GENERATOR
========================================================= */

function normalizeQRText(
  value
) {
  value =
    String(value || '')
      .trim();

  if (!value) {
    throw new Error(
      'Hãy nhập Secret hoặc otpauth://.'
    );
  }

  if (
    value
      .toLowerCase()
      .startsWith(
        'otpauth://'
      )
  ) {
    OTPAuth.URI.parse(
      value
    );

    return value;
  }

  const secret =
    normalizeBase32(
      value
    );

  if (
    !/^[A-Z2-7]+$/
      .test(secret)
  ) {
    throw new Error(
      'Secret không phải Base32 hợp lệ.'
    );
  }

  return makeOtpAuth({
    secret,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    issuer: '2FA',
    account: '2FA'
  });
}

function generateQR(value) {
  if (
    typeof QRCode ===
    'undefined'
  ) {
    throw new Error(
      'Thư viện QRCode chưa tải được.'
    );
  }

  const text =
    normalizeQRText(
      value
    );

  const container =
    $('faQr');

  if (!container) {
    return;
  }

  container.innerHTML =
    '';

  new QRCode(
    container,
    {
      text,
      width: 220,
      height: 220,
      colorDark:
        '#000000',
      colorLight:
        '#ffffff',
      correctLevel:
        QRCode.CorrectLevel.M
    }
  );

  setTimeout(
    () => {
      qrCanvas =
        container.querySelector(
          'canvas'
        );
    },
    50
  );
}

/* =========================================================
   GOOGLE AUTHENTICATOR MIGRATION
========================================================= */

function parseMigrationQR(uri) {
  if (
    !uri.startsWith(
      'otpauth-migration://offline?'
    )
  ) {
    throw new Error(
      'Không phải Google Authenticator Migration QR.'
    );
  }

  const url =
    new URL(uri);

  const encoded =
    url.searchParams.get(
      'data'
    );

  if (!encoded) {
    throw new Error(
      'Migration QR không có data.'
    );
  }

  const bytes =
    base64UrlToBytes(
      encoded
    );

  return parseMigrationBytes(
    bytes
  );
}

function parseMigrationBytes(
  bytes
) {
  let offset = 0;

  const output = [];

  const varint =
    () => {
      let result = 0;
      let shift = 0;

      while (
        offset <
        bytes.length
      ) {
        const b =
          bytes[
            offset++
          ];

        result |=
          (
            b & 127
          ) << shift;

        if (!(b & 128)) {
          break;
        }

        shift += 7;
      }

      return (
        result >>> 0
      );
    };

  while (
    offset <
    bytes.length
  ) {
    const tag =
      varint();

    const wire =
      tag & 7;

    const field =
      tag >>> 3;

    if (field === 1) {
      const len =
        varint();

      const sub =
        bytes.subarray(
          offset,
          offset + len
        );

      offset += len;

      const account =
        parseOtpParameters(
          sub
        );

      if (account) {
        output.push(
          account
        );
      }
    } else if (
      wire === 0
    ) {
      varint();
    } else if (
      wire === 2
    ) {
      const len =
        varint();

      offset += len;
    } else {
      break;
    }
  }

  return output;
}

function parseOtpParameters(
  bytes
) {
  let offset = 0;

  let secretBytes = null;
  let name = '';
  let issuer = '';
  let algorithm = 1;
  let digits = 1;
  let type = 2;

  const varint =
    () => {
      let result = 0;
      let shift = 0;

      while (
        offset <
        bytes.length
      ) {
        const b =
          bytes[
            offset++
          ];

        result |=
          (
            b & 127
          ) << shift;

        if (!(b & 128)) {
          break;
        }

        shift += 7;
      }

      return (
        result >>> 0
      );
    };

  const text =
    () => {
      const len =
        varint();

      const value =
        new TextDecoder()
          .decode(
            bytes.subarray(
              offset,
              offset + len
            )
          );

      offset += len;

      return value;
    };

  while (
    offset <
    bytes.length
  ) {
    const tag =
      varint();

    const wire =
      tag & 7;

    const field =
      tag >>> 3;

    if (field === 1) {
      const len =
        varint();

      secretBytes =
        bytes.subarray(
          offset,
          offset + len
        );

      offset += len;
    } else if (
      field === 2
    ) {
      name = text();
    } else if (
      field === 3
    ) {
      issuer = text();
    } else if (
      field === 4
    ) {
      algorithm =
        varint();
    } else if (
      field === 5
    ) {
      digits =
        varint();
    } else if (
      field === 6
    ) {
      type =
        varint();
    } else if (
      wire === 0
    ) {
      varint();
    } else if (
      wire === 2
    ) {
      const len =
        varint();

      offset += len;
    } else {
      break;
    }
  }

  if (!secretBytes) {
    return null;
  }

  const algorithmMap = {
    1: 'SHA1',
    2: 'SHA256',
    3: 'SHA512',
    4: 'MD5'
  };

  return {
    name,
    account: name,
    issuer,

    secret:
      bytesToBase32(
        secretBytes
      ),

    algorithm:
      algorithmMap[
        algorithm
      ] || 'SHA1',

    digits:
      digits === 2
        ? 8
        : 6,

    period:
      30,

    type
  };
}

function decodeMigration(uri) {
  const result =
    parseMigrationQR(
      uri
    );

  if (!result.length) {
    throw new Error(
      'Không tìm thấy tài khoản trong Migration QR.'
    );
  }

  accounts = [
    ...accounts,
    ...result
  ];

  renderMigrationAccounts();

  if ($('faMigText')) {
    $('faMigText').value =
      uri;
  }

  showStatus(
    `✓ Đã giải mã ${result.length} tài khoản.`,
    'success'
  );
}

async function renderMigrationAccounts() {
  const body =
    $('faAccounts');

  if (!body) {
    return;
  }

  if (!accounts.length) {
    body.innerHTML = `
      <tr>
        <td
          colspan="6"
          class="text-center text-secondary py-4"
        >
          Chưa có tài khoản.
        </td>
      </tr>
    `;

    return;
  }

  const rows =
    await Promise.all(
      accounts.map(
        async (
          acc,
          index
        ) => {
          let otp =
            '------';

          try {
            otp =
              await generateTOTP(
                acc
              );
          } catch {
            // ignore
          }

          return `
            <tr>
              <td>
                ${esc(
                  acc.account ||
                  acc.name ||
                  '-'
                )}
              </td>

              <td>
                ${esc(
                  acc.issuer ||
                  '-'
                )}
              </td>

              <td>
                <code>
                  ${esc(
                    acc.secret
                  )}
                </code>
              </td>

              <td>
                ${esc(
                  acc.algorithm
                )}
              </td>

              <td
                class="fw-bold code-font"
              >
                ${esc(otp)}
              </td>

              <td>
                <button
                  class="btn btn-sm btn-outline-secondary"
                  data-fa-copy="${index}"
                  title="Copy Secret"
                >
                  <i class="bi bi-copy"></i>
                </button>
              </td>
            </tr>
          `;
        }
      )
    );

  body.innerHTML =
    rows.join('');

  body
    .querySelectorAll(
      '[data-fa-copy]'
    )
    .forEach(
      button => {
        button.onclick =
          async () => {
            const index =
              Number(
                button
                  .dataset
                  .faCopy
              );

            await copyText(
              accounts[index]
                .secret
            );

            toast(
              'Đã copy Secret.',
              'success'
            );
          };
      }
    );
}

/* =========================================================
   RENDER
========================================================= */

export function render() {
  clearInterval(
    otpTimer
  );

  otpTimer = null;

  host().innerHTML = `
    <div
      class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3"
    >
      <div>
        <h4 class="mb-1">
          <i class="bi bi-shield-lock-fill me-2 text-primary"></i>
          2FA Authenticator
        </h4>

        <div class="small text-secondary">
          Secret, QR và OTP chỉ xử lý trong trình duyệt.
          Không lưu vào localStorage.
        </div>
      </div>

      <span
        class="badge rounded-pill text-bg-success"
      >
        <i class="bi bi-shield-check me-1"></i>
        Local only
      </span>
    </div>

    <div
      id="faStatus"
      class="alert alert-info py-2 px-3 mt-3 mb-3 d-none"
    ></div>

    <ul
      class="nav nav-tabs mb-3"
      role="tablist"
    >
      <li class="nav-item">

        <button
          class="nav-link active"
          data-bs-toggle="tab"
          data-bs-target="#faAuth"
          type="button"
        >
          <i class="bi bi-key-fill me-1"></i>
          Authenticator
        </button>

      </li>

      <li class="nav-item">

        <button
          class="nav-link"
          data-bs-toggle="tab"
          data-bs-target="#faMigration"
          type="button"
        >
          <i class="bi bi-qr-code-scan me-1"></i>
          Migration QR
        </button>

      </li>
    </ul>

    <div class="tab-content">

      <div
        class="tab-pane fade show active"
        id="faAuth"
      >

        <div class="twofa-grid">

          <div class="card p-3">

            <div
              class="d-flex align-items-center gap-2 mb-3"
            >
              <div class="brand-logo">
                <i class="bi bi-camera-fill"></i>
              </div>

              <div>
                <div class="fw-semibold">
                  QR / Secret → OTP
                </div>

                <div class="small text-secondary">
                  Ctrl+V ảnh QR ở bất kỳ đâu khi đang mở tab 2FA
                </div>
              </div>
            </div>

            <div
              id="faDrop"
              class="qr-drop mb-3"
              tabindex="0"
            >

              <i
                class="bi bi-clipboard-plus fs-2 d-block mb-2"
              ></i>

              <div class="fw-semibold">
                Ctrl + V ảnh QR
              </div>

              <div class="small text-secondary mt-1">
                Hoặc kéo ảnh vào đây / chọn file
              </div>

              <input
                id="faFile"
                class="form-control form-control-sm mt-3"
                type="file"
                accept="image/*"
              >

            </div>

            <textarea
              id="faInput"
              class="form-control code-font"
              rows="4"
              placeholder="Dán Secret hoặc otpauth:// vào đây..."
            ></textarea>

            <div
              class="d-flex flex-wrap gap-2 mt-2"
            >

              <button
                id="faProcess"
                class="btn btn-primary btn-sm"
              >
                <i class="bi bi-key me-1"></i>
                Lấy mã
              </button>

              <button
                id="faCopyCode"
                class="btn btn-outline-secondary btn-sm"
              >
                <i class="bi bi-copy me-1"></i>
                Copy mã
              </button>

              <button
                id="faReset"
                class="btn btn-outline-danger btn-sm"
              >
                <i class="bi bi-trash3 me-1"></i>
                Xóa
              </button>

            </div>

            <div class="text-center mt-4">

              <div class="small text-secondary">
                CURRENT OTP
              </div>

              <div
                id="faCode"
                class="otp-code my-2"
              >
                ------
              </div>

              <div
                id="faTimer"
                class="small text-secondary"
              >
                Chưa có Secret
              </div>

              <div
                class="progress mt-2"
                style="height:4px"
              >
                <div
                  id="faProgress"
                  class="progress-bar"
                  style="width:100%"
                ></div>
              </div>

            </div>

            <div class="row g-2 mt-3 small">

              <div class="col-md-4">

                <div class="text-secondary">
                  Account
                </div>

                <div
                  id="faAccount"
                  class="text-truncate"
                >
                  -
                </div>

              </div>

              <div class="col-md-4">

                <div class="text-secondary">
                  Issuer
                </div>

                <div
                  id="faIssuer"
                  class="text-truncate"
                >
                  -
                </div>

              </div>

              <div class="col-md-4">

                <div class="text-secondary">
                  Config
                </div>

                <div id="faAlgo">
                  SHA1 · 6 digits · 30s
                </div>

              </div>

            </div>

          </div>

          <div class="card p-3">

            <div
              class="d-flex align-items-center gap-2 mb-3"
            >

              <div class="brand-logo">
                <i class="bi bi-qr-code"></i>
              </div>

              <div>

                <div class="fw-semibold">
                  Secret → QR
                </div>

                <div class="small text-secondary">
                  Tạo QR Authenticator từ Secret
                </div>

              </div>

            </div>

            <textarea
              id="faQrInput"
              class="form-control code-font"
              rows="4"
              placeholder="Secret hoặc otpauth://"
            ></textarea>

            <div class="d-flex gap-2 mt-2">

              <button
                id="faQrGenerate"
                class="btn btn-primary btn-sm"
              >
                <i class="bi bi-qr-code me-1"></i>
                Tạo QR
              </button>

              <button
                id="faQrDownload"
                class="btn btn-outline-secondary btn-sm"
              >
                <i class="bi bi-download me-1"></i>
                PNG
              </button>

            </div>

            <div class="qr-preview mt-3">
              <div id="faQr"></div>
            </div>

          </div>

        </div>

      </div>

      <div
        class="tab-pane fade"
        id="faMigration"
      >

        <div class="card p-3">

          <div class="row g-3">

            <div class="col-lg-4">

              <h6>
                <i class="bi bi-qr-code-scan me-2"></i>
                Google Authenticator Migration
              </h6>

              <div class="small text-secondary mb-3">
                Có thể Ctrl+V ảnh Migration QR trực tiếp.
              </div>

              <input
                id="faMigFile"
                type="file"
                accept="image/*"
                class="form-control mb-2"
              >

              <textarea
                id="faMigText"
                class="form-control code-font"
                rows="8"
                placeholder="otpauth-migration://..."
              ></textarea>

              <div class="d-flex gap-2 mt-2">

                <button
                  id="faMigDecode"
                  class="btn btn-primary btn-sm"
                >
                  <i class="bi bi-binary me-1"></i>
                  Giải mã
                </button>

                <button
                  id="faMigClear"
                  class="btn btn-outline-danger btn-sm"
                >
                  <i class="bi bi-trash3 me-1"></i>
                  Xóa
                </button>

              </div>

            </div>

            <div class="col-lg-8">

              <div class="table-responsive">

                <table
                  class="table table-sm align-middle"
                >

                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>Issuer</th>
                      <th>Secret</th>
                      <th>Algo</th>
                      <th>OTP</th>
                      <th></th>
                    </tr>
                  </thead>

                  <tbody id="faAccounts"></tbody>

                </table>

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>
  `;

  /* =========================
     AUTH
  ========================= */

  $('faProcess').onclick =
    () => {
      try {
        parseOTPAuth(
          $('faInput').value
        );

        $('faQrInput').value =
          $('faInput').value;

        updateInfo();
        startOTP();
        clearStatus();
      } catch (error) {
        showStatus(
          error.message,
          'danger'
        );
      }
    };

  $('faCopyCode').onclick =
    async () => {
      const code =
        $('faCode')
          .textContent
          .trim();

      if (
        !code ||
        code === '------'
      ) {
        toast(
          'Chưa có mã OTP.',
          'warning'
        );

        return;
      }

      await copyText(
        code
      );

      toast(
        'Đã copy OTP.',
        'success'
      );
    };

  $('faReset').onclick =
    resetCurrent;

  /* =========================
     FILE
  ========================= */

  $('faFile').onchange =
    event => {
      readQR(
        event
          .target
          .files?.[0]
      );

      event.target.value =
        '';
    };

  $('faMigFile').onchange =
    event => {
      readQR(
        event
          .target
          .files?.[0]
      );

      event.target.value =
        '';
    };

  /* =========================
     DRAG DROP
  ========================= */

  const drop =
    $('faDrop');

  [
    'dragenter',
    'dragover'
  ].forEach(
    eventName => {
      drop.addEventListener(
        eventName,
        event => {
          event.preventDefault();

          drop.classList.add(
            'drag'
          );
        }
      );
    }
  );

  [
    'dragleave',
    'drop'
  ].forEach(
    eventName => {
      drop.addEventListener(
        eventName,
        event => {
          event.preventDefault();

          drop.classList.remove(
            'drag'
          );
        }
      );
    }
  );

  drop.addEventListener(
    'drop',
    event => {
      const file =
        [
          ...event
            .dataTransfer
            .files
        ].find(
          file =>
            String(
              file.type
            ).startsWith(
              'image/'
            )
        );

      if (file) {
        readQR(
          file
        );
      }
    }
  );

  /*
   * Fallback paste trực tiếp
   * trên drop zone.
   */
  drop.addEventListener(
    'paste',
    globalPasteHandler,
    true
  );

  /* =========================
     QR GENERATOR
  ========================= */

  $('faQrGenerate').onclick =
    () => {
      try {
        generateQR(
          $('faQrInput').value
        );

        showStatus(
          '✓ QR đã được tạo.',
          'success'
        );
      } catch (error) {
        showStatus(
          error.message,
          'danger'
        );
      }
    };

  $('faQrDownload').onclick =
    () => {
      if (!qrCanvas) {
        toast(
          'Chưa có QR.',
          'warning'
        );

        return;
      }

      const link =
        document.createElement(
          'a'
        );

      link.download =
        '2FA-QR.png';

      link.href =
        qrCanvas.toDataURL(
          'image/png'
        );

      link.click();
    };

  /* =========================
     MIGRATION
  ========================= */

  $('faMigDecode').onclick =
    () => {
      try {
        decodeMigration(
          $('faMigText')
            .value
            .trim()
        );
      } catch (error) {
        showStatus(
          error.message,
          'danger'
        );
      }
    };

  $('faMigClear').onclick =
    () => {
      accounts = [];

      if ($('faMigText')) {
        $('faMigText').value =
          '';
      }

      renderMigrationAccounts();
    };

  renderMigrationAccounts();

  /*
   * Nếu đã có Secret
   * thì render lại OTP.
   */
  if (current.secret) {
    $('faInput').value =
      makeOtpAuth(
        current
      );

    $('faQrInput').value =
      makeOtpAuth(
        current
      );

    updateInfo();
    startOTP();
  }
}

/* =========================================================
   MODULE
========================================================= */

export const TwoFA = {
  init() {
    if (pasteBound) {
      return;
    }

    /*
     * Quan trọng:
     * bắt paste ở window
     * + capture phase.
     *
     * Vì vậy Ctrl+V ảnh
     * ở bất kỳ đâu khi
     * đang mở module 2FA
     * đều được nhận.
     */
    window.addEventListener(
      'paste',
      globalPasteHandler,
      true
    );

    pasteBound = true;
  },

  render
};
