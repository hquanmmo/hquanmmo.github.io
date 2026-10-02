import { esc, toast, copyText } from '../utils.js';

const host = () => document.getElementById('module-twofa');
const $ = id => document.getElementById(id);

let current = {
  secret: '',
  algorithm: 'SHA1',
  digits: 6,
  period: 30,
  issuer: '',
  account: '',
  type: 2,
  counter: 0
};

let accounts = [];
let otpTimer = null;
let accountTimer = null;
let qrCanvas = null;
let pasteBound = false;

// batchId -> {
//   batchId,
//   batchSize,
//   version,
//   pages: Map(index -> payload)
// }
const migrationBatches = new Map();


/* =========================================================
   BASIC HELPERS
========================================================= */

const normalizeBase32 = value =>
  String(value || '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/-/g, '')
    .replace(/=/g, '');


const isBase32 = value =>
  Boolean(value) &&
  /^[A-Z2-7]+$/.test(value);


function bytesToBase32(buffer) {

  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

  let bits = 0;
  let value = 0;
  let out = '';

  for (const byte of buffer) {

    value =
      (value << 8) |
      byte;

    bits += 8;

    while (bits >= 5) {

      out +=
        alphabet[
          (
            value >>>
            (bits - 5)
          ) & 31
        ];

      bits -= 5;
    }
  }

  if (bits > 0) {

    out +=
      alphabet[
        (
          value <<
          (5 - bits)
        ) & 31
      ];
  }

  return out;
}


function base32ToBytes(secret) {

  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

  let bits = '';

  const bytes = [];

  for (
    const ch
    of normalizeBase32(secret)
  ) {

    const idx =
      alphabet.indexOf(ch);

    if (idx < 0) {

      throw new Error(
        'Secret Base32 không hợp lệ.'
      );
    }

    bits +=
      idx
        .toString(2)
        .padStart(
          5,
          '0'
        );
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

  return new Uint8Array(
    bytes
  );
}


function accountKey(acc) {

  return [

    normalizeBase32(
      acc.secret
    ),

    acc.name ||
    acc.account ||
    '',

    acc.issuer ||
    '',

    Number(
      acc.type ?? 2
    ),

    String(
      acc.counter ?? 0
    )

  ].join('|');
}


function mergeAccounts(list) {

  const known =
    new Set(
      accounts.map(
        accountKey
      )
    );

  let added = 0;

  for (
    const acc
    of list
  ) {

    const key =
      accountKey(acc);

    if (
      known.has(key)
    ) {

      continue;
    }

    known.add(key);

    accounts.push(acc);

    added++;
  }

  return added;
}


function splitNameIssuer(
  name,
  issuer
) {

  let finalName =
    String(
      name || ''
    ).trim();

  let finalIssuer =
    String(
      issuer || ''
    ).trim();


  /*
   * Google Authenticator đôi khi:
   *
   * issuer = ""
   * name = "Microsoft:user@email.com"
   */
  if (!finalIssuer) {

    const pos =
      finalName.indexOf(':');

    if (pos > 0) {

      finalIssuer =
        finalName
          .slice(
            0,
            pos
          )
          .trim();

      finalName =
        finalName
          .slice(
            pos + 1
          )
          .trim();
    }
  }

  return {

    account:
      finalName,

    issuer:
      finalIssuer
  };
}


function algorithmLabel(value) {

  return ({
    0: 'SHA1',
    1: 'SHA1',
    2: 'SHA256',
    3: 'SHA512',
    4: 'MD5'
  })[
    Number(value)
  ] || 'SHA1';
}


function digitsValue(value) {

  return (
    Number(value) === 2
      ? 8
      : 6
  );
}


function typeLabel(value) {

  return (
    Number(value) === 1
      ? 'HOTP'
      : 'TOTP'
  );
}


function isTwoFAActive() {

  const el =
    host();

  return Boolean(
    el &&
    el.classList.contains(
      'active'
    )
  );
}


/* =========================================================
   STATUS
========================================================= */

function showStatus(
  id,
  text,
  type = 'info'
) {

  const el =
    $(id);

  if (!el) {
    return;
  }

  const classes = {

    success:
      'alert-success',

    danger:
      'alert-danger',

    warning:
      'alert-warning',

    info:
      'alert-info'
  };

  el.className =
    `alert ${
      classes[type] ||
      classes.info
    } py-2 px-3 mb-3`;

  el.textContent =
    text;

  el.classList.remove(
    'd-none'
  );
}


function hideStatus(id) {

  const el =
    $(id);

  if (!el) {
    return;
  }

  el.className =
    'd-none';

  el.textContent =
    '';
}


/* =========================================================
   NORMAL OTPAUTH
========================================================= */

function parseOTPAuth(value) {

  const input =
    String(
      value || ''
    ).trim();

  if (!input) {

    throw new Error(
      'Chưa có dữ liệu.'
    );
  }


  /*
   * Secret thuần
   */
  if (
    !input
      .toLowerCase()
      .startsWith(
        'otpauth://'
      )
  ) {

    const secret =
      normalizeBase32(
        input
      );

    if (
      !isBase32(secret)
    ) {

      throw new Error(
        'Secret không phải Base32 hợp lệ.'
      );
    }

    current = {

      secret,

      algorithm:
        'SHA1',

      digits:
        6,

      period:
        30,

      issuer:
        '',

      account:
        '',

      type:
        2,

      counter:
        0
    };

    return current;
  }


  /*
   * otpauth://
   */
  let url;

  try {

    url =
      new URL(input);

  } catch {

    throw new Error(
      'otpauth:// không hợp lệ.'
    );
  }


  const otpType =
    String(
      url.hostname ||
      ''
    )
      .toLowerCase();


  if (
    otpType !== 'totp' &&
    otpType !== 'hotp'
  ) {

    throw new Error(
      'Chỉ hỗ trợ TOTP/HOTP.'
    );
  }


  const secret =
    normalizeBase32(

      url
        .searchParams
        .get('secret')

    );


  if (
    !isBase32(secret)
  ) {

    throw new Error(
      'Secret trong QR không hợp lệ.'
    );
  }


  let label =
    url.pathname
      .replace(
        /^\/+/,
        ''
      );


  try {

    label =
      decodeURIComponent(
        label
      );

  } catch {
    // giữ nguyên
  }


  let issuer =

    url
      .searchParams
      .get('issuer') ||

    '';


  let account =
    label;


  const colon =
    label.indexOf(':');


  if (
    colon >= 0
  ) {

    if (!issuer) {

      issuer =
        label
          .slice(
            0,
            colon
          )
          .trim();
    }

    account =
      label
        .slice(
          colon + 1
        )
        .trim();
  }


  let algorithm =
    String(

      url
        .searchParams
        .get('algorithm') ||

      'SHA1'

    )
      .toUpperCase();


  if (
    ![
      'SHA1',
      'SHA256',
      'SHA512'
    ].includes(
      algorithm
    )
  ) {

    algorithm =
      'SHA1';
  }


  let digits =
    Number(

      url
        .searchParams
        .get('digits') ||

      6

    );


  if (
    digits !== 8
  ) {

    digits =
      6;
  }


  let period =
    Number(

      url
        .searchParams
        .get('period') ||

      30

    );


  if (
    !Number.isFinite(
      period
    ) ||
    period <= 0
  ) {

    period =
      30;
  }


  let counter =
    Number(

      url
        .searchParams
        .get('counter') ||

      0

    );


  if (
    !Number.isSafeInteger(
      counter
    ) ||
    counter < 0
  ) {

    counter =
      0;
  }


  current = {

    secret,

    algorithm,

    digits,

    period,

    issuer,

    account,

    type:
      otpType === 'hotp'
        ? 1
        : 2,

    counter
  };


  return current;
}


/* =========================================================
   CREATE OTPAUTH
========================================================= */

function makeOtpAuth(acc) {

  const issuer =
    String(
      acc.issuer ||
      '2FA'
    );

  const account =
    String(
      acc.account ||
      '2FA'
    );

  const label =
    encodeURIComponent(
      `${issuer}:${account}`
    );

  const kind =
    Number(acc.type) === 1
      ? 'hotp'
      : 'totp';


  let uri =

    `otpauth://${kind}/${label}` +

    `?secret=${
      encodeURIComponent(
        acc.secret
      )
    }` +

    `&issuer=${
      encodeURIComponent(
        issuer
      )
    }` +

    `&algorithm=${
      encodeURIComponent(
        acc.algorithm ||
        'SHA1'
      )
    }` +

    `&digits=${
      encodeURIComponent(
        acc.digits ||
        6
      )
    }`;


  if (
    kind === 'hotp'
  ) {

    uri +=
      `&counter=${
        encodeURIComponent(
          acc.counter ||
          0
        )
      }`;

  } else {

    uri +=
      `&period=${
        encodeURIComponent(
          acc.period ||
          30
        )
      }`;
  }


  return uri;
}


/* =========================================================
   OTP CORE
========================================================= */

function counterToBytes(counter) {

  let n;

  try {

    n =
      BigInt(counter);

  } catch {

    n =
      0n;
  }


  const out =
    new Uint8Array(8);


  for (
    let i = 7;
    i >= 0;
    i--
  ) {

    out[i] =
      Number(
        n & 255n
      );

    n >>= 8n;
  }


  return out;
}


async function hmacOtp(
  acc,
  counter
) {

  const keyBytes =
    base32ToBytes(
      acc.secret
    );


  const alg =
    String(
      acc.algorithm ||
      'SHA1'
    )
      .toUpperCase();


  /*
   * Web Crypto không hỗ trợ MD5.
   * Không được tự chuyển MD5 -> SHA1
   * vì sẽ tạo mã sai.
   */
  if (
    alg === 'MD5'
  ) {

    throw new Error(
      'MD5 không được Web Crypto hỗ trợ.'
    );
  }


  const hash =

    alg === 'SHA512'

      ? 'SHA-512'

      : alg === 'SHA256'

        ? 'SHA-256'

        : 'SHA-1';


  const key =
    await crypto.subtle.importKey(

      'raw',

      keyBytes,

      {
        name:
          'HMAC',

        hash
      },

      false,

      [
        'sign'
      ]

    );


  const signature =
    new Uint8Array(

      await crypto.subtle.sign(

        'HMAC',

        key,

        counterToBytes(
          counter
        )

      )

    );


  const offset =
    signature[
      signature.length - 1
    ] & 15;


  const binary = (

    (
      (
        signature[offset] &
        127
      ) << 24
    ) |

    (
      (
        signature[
          offset + 1
        ] &
        255
      ) << 16
    ) |

    (
      (
        signature[
          offset + 2
        ] &
        255
      ) << 8
    ) |

    (
      signature[
        offset + 3
      ] &
      255
    )

  ) >>> 0;


  const digits =
    Number(
      acc.digits
    ) === 8
      ? 8
      : 6;


  return String(

    binary %
    Math.pow(
      10,
      digits
    )

  )
    .padStart(
      digits,
      '0'
    );
}


async function generateOTP(
  acc = current
) {

  if (
    !acc.secret
  ) {

    throw new Error(
      'Không có Secret.'
    );
  }


  /*
   * HOTP
   */
  if (
    Number(acc.type) === 1
  ) {

    return hmacOtp(

      acc,

      BigInt(
        acc.counter ||
        0
      )

    );
  }


  /*
   * TOTP
   */
  const period =
    Number(
      acc.period
    ) || 30;


  const counter =
    BigInt(

      Math.floor(

        Date.now() /
        1000 /
        period

      )

    );


  return hmacOtp(
    acc,
    counter
  );
}


/* =========================================================
   NORMAL OTP UI
========================================================= */

function updateInfo() {

  if (
    !$('faAccount')
  ) {

    return;
  }


  $('faAccount')
    .textContent =

    current.account ||
    '-';


  $('faIssuer')
    .textContent =

    current.issuer ||
    '-';


  $('faAlgo')
    .textContent =

    `${
      typeLabel(
        current.type
      )
    } · ${
      current.algorithm
    } · ${
      current.digits
    } digits${
      Number(current.type) === 1

        ? ` · counter ${
            current.counter ||
            0
          }`

        : ` · ${
            current.period
          }s`
    }`;
}


async function updateMainOTP() {

  if (
    !current.secret ||
    !$('faCode')
  ) {

    return;
  }


  try {

    $('faCode')
      .textContent =

      await generateOTP(
        current
      );


    /*
     * HOTP
     */
    if (
      Number(
        current.type
      ) === 1
    ) {

      $('faTimer')
        .textContent =

        `HOTP · counter ${
          current.counter ||
          0
        }`;


      $('faProgress')
        .style.width =
        '100%';


      return;
    }


    /*
     * TOTP
     */
    const period =
      Number(
        current.period
      ) || 30;


    const remaining =

      period -

      (
        Math.floor(
          Date.now() /
          1000
        ) %
        period
      );


    $('faTimer')
      .textContent =

      `Mã mới sau ${remaining} giây`;


    $('faProgress')
      .style.width =

      `${
        remaining /
        period *
        100
      }%`;

  } catch (error) {

    showStatus(

      'faStatus',

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


  if (
    Number(
      current.type
    ) !== 1
  ) {

    otpTimer =
      setInterval(

        updateMainOTP,

        1000

      );
  }
}


/* =========================================================
   QR DECODER
========================================================= */

/*
 * Chrome/Edge có BarcodeDetector
 * thường đọc QR Migration dày tốt hơn jsQR.
 */
async function nativeBarcodeDecode(file) {

  if (
    !(
      'BarcodeDetector'
      in window
    ) ||
    !(
      'createImageBitmap'
      in window
    )
  ) {

    return '';
  }


  try {

    const formats =
      await BarcodeDetector
        .getSupportedFormats?.();


    if (
      formats &&
      !formats.includes(
        'qr_code'
      )
    ) {

      return '';
    }


    const bitmap =
      await createImageBitmap(
        file
      );


    const detector =
      new BarcodeDetector({

        formats:
          [
            'qr_code'
          ]

      });


    const found =
      await detector.detect(
        bitmap
      );


    bitmap.close?.();


    return (
      found?.[0]
        ?.rawValue ||
      ''
    );

  } catch {

    return '';
  }
}


function fileReaderImage(file) {

  return new Promise(

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

          const image =
            new Image();


          image.onerror =
            () => {

              reject(
                new Error(
                  'Ảnh không hợp lệ.'
                )
              );
            };


          image.onload =
            () => {

              resolve(
                image
              );
            };


          image.src =
            event.target.result;
        };


      reader.readAsDataURL(
        file
      );
    }

  );
}


/*
 * Fallback bằng jsQR.
 * Thử nhiều scale để tăng khả năng đọc
 * QR Export của Google Authenticator.
 */
function jsQrDecodeFromImage(image) {

  if (
    typeof jsQR ===
    'undefined'
  ) {

    throw new Error(
      'jsQR chưa được tải.'
    );
  }


  const max =
    4096;


  let width =
    image.naturalWidth;


  let height =
    image.naturalHeight;


  if (
    Math.max(
      width,
      height
    ) >
    max
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


  const base =
    document.createElement(
      'canvas'
    );


  base.width =
    width;


  base.height =
    height;


  const ctx =
    base.getContext(

      '2d',

      {
        willReadFrequently:
          true
      }

    );


  ctx.drawImage(

    image,

    0,
    0,

    width,
    height

  );


  const attempts = [

    {
      canvas:
        base,

      w:
        width,

      h:
        height
    },

    {
      scale:
        1.5
    },

    {
      scale:
        2
    }

  ];


  for (
    const attempt
    of attempts
  ) {

    let canvas =
      attempt.canvas;


    let w =
      attempt.w;


    let h =
      attempt.h;


    if (!canvas) {

      const scale =
        Math.min(

          attempt.scale,

          4096 /
          Math.max(
            width,
            height
          )

        );


      w =
        Math.round(
          width *
          scale
        );


      h =
        Math.round(
          height *
          scale
        );


      canvas =
        document.createElement(
          'canvas'
        );


      canvas.width =
        w;


      canvas.height =
        h;


      const c =
        canvas.getContext(

          '2d',

          {
            willReadFrequently:
              true
          }

        );


      c.imageSmoothingEnabled =
        false;


      c.drawImage(

        base,

        0,
        0,

        w,
        h

      );
    }


    const c =
      canvas.getContext(

        '2d',

        {
          willReadFrequently:
            true
        }

      );


    const data =
      c.getImageData(

        0,
        0,

        w,
        h

      );


    const qr =
      jsQR(

        data.data,

        w,

        h,

        {
          inversionAttempts:
            'attemptBoth'
        }

      );


    if (
      qr?.data
    ) {

      return qr.data;
    }
  }


  return '';
}


async function decodeQrFile(file) {

  if (!file) {

    throw new Error(
      'Không có ảnh QR.'
    );
  }


  /*
   * 1. Native browser detector
   */
  const native =
    await nativeBarcodeDecode(
      file
    );


  if (native) {

    return native.trim();
  }


  /*
   * 2. jsQR fallback
   */
  const image =
    await fileReaderImage(
      file
    );


  const fallback =
    jsQrDecodeFromImage(
      image
    );


  if (!fallback) {

    throw new Error(
      'Không tìm thấy QR trong ảnh.'
    );
  }


  return fallback.trim();
}


async function readQR(file) {

  try {

    showStatus(
      'faStatus',
      'Đang đọc QR...',
      'info'
    );


    showStatus(
      'faMigrationStatus',
      'Đang đọc QR...',
      'info'
    );


    const text =
      await decodeQrFile(
        file
      );


    handleQRText(
      text
    );

  } catch (error) {

    showStatus(

      'faStatus',

      error.message ||
      'Không đọc được QR.',

      'danger'

    );


    showStatus(

      'faMigrationStatus',

      error.message ||
      'Không đọc được QR.',

      'danger'

    );
  }
}


/* =========================================================
   PROTOBUF READER
========================================================= */

class ProtoReader {

  constructor(bytes) {

    this.bytes =
      bytes;

    this.offset =
      0;
  }


  eof() {

    return (
      this.offset >=
      this.bytes.length
    );
  }


  /*
   * Dùng BigInt để tránh lỗi
   * varint > 32 bit.
   */
  readVarintBig() {

    let result =
      0n;

    let shift =
      0n;


    while (
      !this.eof()
    ) {

      const byte =
        BigInt(

          this.bytes[
            this.offset++
          ]

        );


      result |=

        (
          byte &
          0x7fn
        ) << shift;


      if (
        (
          byte &
          0x80n
        ) === 0n
      ) {

        return result;
      }


      shift +=
        7n;


      if (
        shift > 70n
      ) {

        throw new Error(
          'Varint protobuf không hợp lệ.'
        );
      }
    }


    throw new Error(
      'Payload protobuf bị thiếu dữ liệu.'
    );
  }


  readVarintNumber() {

    const value =
      this.readVarintBig();


    if (
      value >
      BigInt(
        Number.MAX_SAFE_INTEGER
      )
    ) {

      throw new Error(
        'Giá trị protobuf quá lớn.'
      );
    }


    return Number(
      value
    );
  }


  readLengthDelimited() {

    const length =
      this.readVarintNumber();


    const end =
      this.offset +
      length;


    if (
      end >
      this.bytes.length
    ) {

      throw new Error(
        'Field protobuf vượt quá payload.'
      );
    }


    const out =
      this.bytes.subarray(

        this.offset,

        end

      );


    this.offset =
      end;


    return out;
  }


  readString() {

    return new TextDecoder()
      .decode(
        this.readLengthDelimited()
      );
  }


  skip(wire) {

    /*
     * varint
     */
    if (
      wire === 0
    ) {

      this.readVarintBig();

      return;
    }


    /*
     * 64-bit
     */
    if (
      wire === 1
    ) {

      this.offset +=
        8;

      return;
    }


    /*
     * length-delimited
     */
    if (
      wire === 2
    ) {

      this.readLengthDelimited();

      return;
    }


    /*
     * 32-bit
     */
    if (
      wire === 5
    ) {

      this.offset +=
        4;

      return;
    }


    throw new Error(

      `Wire type protobuf không hỗ trợ: ${wire}`

    );
  }
}


/* =========================================================
   GOOGLE AUTHENTICATOR MIGRATION
========================================================= */

/*
 * Không dùng URLSearchParams cho data=
 * để tránh trường hợp dấu + của Base64
 * bị biến thành space.
 */
function migrationDataFromUri(uri) {

  const text =
    String(
      uri || ''
    ).trim();


  const prefix =
    'otpauth-migration://offline?';


  if (
    !text.startsWith(
      prefix
    )
  ) {

    throw new Error(
      'Không phải Google Authenticator Migration QR.'
    );
  }


  const query =
    text.slice(
      prefix.length
    );


  const match =
    query.match(

      /(?:^|&)data=([^&]*)/

    );


  if (
    !match?.[1]
  ) {

    throw new Error(
      'Migration QR không có data.'
    );
  }


  let encoded =
    match[1];


  /*
   * Percent encoded base64
   */
  try {

    encoded =
      decodeURIComponent(
        encoded
      );

  } catch {
    // giữ nguyên
  }


  /*
   * Hỗ trợ:
   * Base64
   * Base64 URL safe
   */
  encoded =
    encoded

      .replace(
        / /g,
        '+'
      )

      .replace(
        /-/g,
        '+'
      )

      .replace(
        /_/g,
        '/'
      );


  /*
   * Base64 padding
   */
  while (
    encoded.length % 4
  ) {

    encoded +=
      '=';
  }


  let binary;


  try {

    binary =
      atob(
        encoded
      );

  } catch {

    throw new Error(
      'Không giải mã được Base64 của Migration QR.'
    );
  }


  return Uint8Array.from(

    binary,

    ch =>
      ch.charCodeAt(0)

  );
}


/* =========================================================
   OTP PARAMETERS
========================================================= */

function parseOtpParameters(bytes) {

  const r =
    new ProtoReader(
      bytes
    );


  let secretBytes =
    null;


  let name =
    '';


  let issuer =
    '';


  let algorithm =
    1;


  let digits =
    1;


  let type =
    2;


  let counter =
    0n;


  while (
    !r.eof()
  ) {

    const tag =
      r.readVarintNumber();


    const field =
      Math.floor(
        tag / 8
      );


    const wire =
      tag & 7;


    /*
     * secret = field 1
     */
    if (
      field === 1 &&
      wire === 2
    ) {

      secretBytes =
        r.readLengthDelimited();

    }


    /*
     * name = field 2
     */
    else if (
      field === 2 &&
      wire === 2
    ) {

      name =
        r.readString();

    }


    /*
     * issuer = field 3
     */
    else if (
      field === 3 &&
      wire === 2
    ) {

      issuer =
        r.readString();

    }


    /*
     * algorithm = field 4
     */
    else if (
      field === 4 &&
      wire === 0
    ) {

      algorithm =
        r.readVarintNumber();

    }


    /*
     * digits = field 5
     */
    else if (
      field === 5 &&
      wire === 0
    ) {

      digits =
        r.readVarintNumber();

    }


    /*
     * type = field 6
     */
    else if (
      field === 6 &&
      wire === 0
    ) {

      type =
        r.readVarintNumber();

    }


    /*
     * counter = field 7
     */
    else if (
      field === 7 &&
      wire === 0
    ) {

      counter =
        r.readVarintBig();

    }


    else {

      r.skip(
        wire
      );
    }
  }


  if (
    !secretBytes?.length
  ) {

    return null;
  }


  const normalized =
    splitNameIssuer(
      name,
      issuer
    );


  return {

    name:
      normalized.account,

    account:
      normalized.account,

    issuer:
      normalized.issuer,

    secret:
      bytesToBase32(
        secretBytes
      ),

    algorithm:
      algorithmLabel(
        algorithm
      ),

    digits:
      digitsValue(
        digits
      ),

    type:
      Number(type) === 1
        ? 1
        : 2,

    /*
     * giữ string để không mất
     * precision của int64
     */
    counter:
      counter.toString(),

    period:
      30
  };
}


/* =========================================================
   MIGRATION PAYLOAD
========================================================= */

function parseMigrationPayload(bytes) {

  const r =
    new ProtoReader(
      bytes
    );


  const payload = {

    accounts:
      [],

    version:
      0,

    batchSize:
      1,

    batchIndex:
      0,

    batchId:
      '0'
  };


  while (
    !r.eof()
  ) {

    const tag =
      r.readVarintNumber();


    const field =
      Math.floor(
        tag / 8
      );


    const wire =
      tag & 7;


    /*
     * repeated OtpParameters = 1
     */
    if (
      field === 1 &&
      wire === 2
    ) {

      const acc =
        parseOtpParameters(

          r.readLengthDelimited()

        );


      if (acc) {

        payload
          .accounts
          .push(acc);
      }
    }


    /*
     * version = 2
     */
    else if (
      field === 2 &&
      wire === 0
    ) {

      payload.version =
        r.readVarintNumber();
    }


    /*
     * batch_size = 3
     */
    else if (
      field === 3 &&
      wire === 0
    ) {

      payload.batchSize =
        r.readVarintNumber();
    }


    /*
     * batch_index = 4
     */
    else if (
      field === 4 &&
      wire === 0
    ) {

      payload.batchIndex =
        r.readVarintNumber();
    }


    /*
     * batch_id = 5
     */
    else if (
      field === 5 &&
      wire === 0
    ) {

      payload.batchId =
        r
          .readVarintBig()
          .toString();
    }


    else {

      r.skip(
        wire
      );
    }
  }


  if (
    !payload.batchSize ||
    payload.batchSize < 1
  ) {

    payload.batchSize =
      1;
  }


  if (
    payload.batchIndex < 0
  ) {

    payload.batchIndex =
      0;
  }


  return payload;
}


/* =========================================================
   BATCH MANAGEMENT
========================================================= */

function batchProgressText(batch) {

  const scanned =
    [
      ...batch
        .pages
        .keys()
    ]
      .sort(
        (a, b) =>
          a - b
      );


  const human =
    scanned
      .map(
        index =>
          index + 1
      )
      .join(', ');


  const missing =
    [];


  for (
    let i = 0;
    i < batch.batchSize;
    i++
  ) {

    if (
      !batch
        .pages
        .has(i)
    ) {

      missing.push(
        i + 1
      );
    }
  }


  if (
    !missing.length
  ) {

    return (
      `Batch hoàn tất ${
        batch.batchSize
      }/${
        batch.batchSize
      } QR.`
    );
  }


  return (

    `Batch ${
      batch.pages.size
    }/${
      batch.batchSize
    } QR · ` +

    `đã nhận: ${
      human || '-'
    } · ` +

    `còn thiếu: ${
      missing.join(', ')
    }`

  );
}


function registerMigrationPayload(
  payload
) {

  const batchKey =
    `${
      payload.batchId
    }:${
      payload.batchSize
    }`;


  let batch =
    migrationBatches.get(
      batchKey
    );


  if (!batch) {

    batch = {

      batchId:
        payload.batchId,

      batchSize:
        payload.batchSize,

      version:
        payload.version,

      pages:
        new Map()
    };


    migrationBatches.set(
      batchKey,
      batch
    );
  }


  const duplicatePage =
    batch
      .pages
      .has(
        payload.batchIndex
      );


  /*
   * cùng QR index sẽ ghi đè
   * chứ không tăng số trang.
   */
  batch.pages.set(

    payload.batchIndex,

    payload

  );


  /*
   * Accounts được cộng dồn ngay
   * khi quét từng QR.
   */
  const added =
    mergeAccounts(
      payload.accounts
    );


  return {

    batch,

    added,

    duplicatePage,

    complete:

      batch.pages.size >=
      batch.batchSize
  };
}


/* =========================================================
   DECODE MIGRATION
========================================================= */

function decodeMigration(uri) {

  const bytes =
    migrationDataFromUri(
      uri
    );


  const payload =
    parseMigrationPayload(
      bytes
    );


  if (
    !payload.accounts.length
  ) {

    throw new Error(
      'Migration QR hợp lệ nhưng không có tài khoản.'
    );
  }


  const result =
    registerMigrationPayload(
      payload
    );


  renderAccounts();

  startAccountTimer();

  renderBatchState();


  return {

    payload,

    ...result
  };
}


/* =========================================================
   HANDLE QR CONTENT
========================================================= */

function handleQRText(text) {

  const value =
    String(
      text || ''
    ).trim();


  if (!value) {

    throw new Error(
      'QR không có dữ liệu.'
    );
  }


  if (
    $('faMigrationText')
  ) {

    $('faMigrationText')
      .value =
      value;
  }


  /* -------------------------------------------------------
     GOOGLE MIGRATION
  ------------------------------------------------------- */

  if (
    value.startsWith(
      'otpauth-migration://'
    )
  ) {

    const result =
      decodeMigration(
        value
      );


    const tab =
      document.querySelector(

        '[data-bs-target="#faMigration"]'

      );


    if (tab) {

      bootstrap.Tab
        .getOrCreateInstance(
          tab
        )
        .show();
    }


    const pageNo =
      result
        .payload
        .batchIndex +
      1;


    const progress =
      batchProgressText(
        result.batch
      );


    const duplicate =

      result.duplicatePage

        ? ' QR này đã được quét trước đó.'

        : '';


    showStatus(

      'faMigrationStatus',

      `✓ QR ${
        pageNo
      }/${
        result.payload.batchSize
      }: thêm ${
        result.added
      } tài khoản. ${
        progress
      }${
        duplicate
      }`,

      result.complete
        ? 'success'
        : 'info'

    );


    hideStatus(
      'faStatus'
    );


    return;
  }


  /* -------------------------------------------------------
     NORMAL OTPAUTH
  ------------------------------------------------------- */

  if (
    value.startsWith(
      'otpauth://'
    )
  ) {

    parseOTPAuth(
      value
    );


    if (
      $('faInput')
    ) {

      $('faInput')
        .value =
        value;
    }


    if (
      $('faQrInput')
    ) {

      $('faQrInput')
        .value =
        value;
    }


    updateInfo();

    startOTP();


    const tab =
      document.querySelector(

        '[data-bs-target="#faAuth"]'

      );


    if (tab) {

      bootstrap.Tab
        .getOrCreateInstance(
          tab
        )
        .show();
    }


    showStatus(

      'faStatus',

      '✓ Đã đọc QR otpauth.',

      'success'

    );


    hideStatus(
      'faMigrationStatus'
    );


    return;
  }


  /* -------------------------------------------------------
     BASE32 IN QR
  ------------------------------------------------------- */

  const secret =
    normalizeBase32(
      value
    );


  if (
    isBase32(secret)
  ) {

    parseOTPAuth(
      secret
    );


    $('faInput')
      .value =
      secret;


    $('faQrInput')
      .value =
      secret;


    updateInfo();

    startOTP();


    showStatus(

      'faStatus',

      '✓ Đã đọc Secret Base32 từ QR.',

      'success'

    );


    return;
  }


  throw new Error(
    'QR không chứa dữ liệu 2FA hợp lệ.'
  );
}


/* =========================================================
   MIGRATION BATCH UI
========================================================= */

function renderBatchState() {

  const box =
    $('faBatchState');


  if (!box) {

    return;
  }


  if (
    !migrationBatches.size
  ) {

    box.innerHTML =

      '<div class="small text-secondary">Chưa có batch Migration.</div>';


    return;
  }


  box.innerHTML =

    [
      ...migrationBatches.values()
    ]
      .map(

        batch => {

          const done =

            batch.pages.size >=
            batch.batchSize;


          return `

            <div
              class="d-flex align-items-center justify-content-between gap-2 py-1"
            >

              <div
                class="small text-truncate"
              >

                <i
                  class="bi ${
                    done
                      ? 'bi-check-circle-fill text-success'
                      : 'bi-collection text-primary'
                  } me-1"
                ></i>

                Batch ${
                  esc(
                    batch.batchId
                  )
                }

              </div>


              <span
                class="badge ${
                  done
                    ? 'text-bg-success'
                    : 'text-bg-secondary'
                }"
              >

                ${
                  batch.pages.size
                }/${
                  batch.batchSize
                }

              </span>

            </div>

          `;
        }

      )
      .join('');
}


/* =========================================================
   MIGRATION TABLE
========================================================= */

async function renderAccounts() {

  const body =
    $('faAccounts');


  if (!body) {

    return;
  }


  $('faAccountCount')
    .textContent =

    String(
      accounts.length
    );


  if (
    !accounts.length
  ) {

    body.innerHTML = `

      <tr>

        <td
          colspan="8"
          class="text-center text-secondary py-5"
        >

          <i
            class="bi bi-qr-code-scan fs-2 d-block mb-2"
          ></i>

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
              await generateOTP(
                acc
              );

          } catch {
            // unsupported algorithm etc.
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

                <span
                  class="badge ${
                    Number(acc.type) === 1

                      ? 'text-bg-warning'

                      : 'text-bg-primary'
                  }"
                >

                  ${
                    typeLabel(
                      acc.type
                    )
                  }

                </span>

              </td>


              <td>

                <code
                  class="small"
                >

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


              <td>

                ${
                  acc.digits
                }

              </td>


              <td
                class="fw-bold code-font text-success"
                data-fa-otp="${index}"
              >

                ${esc(
                  otp
                )}

              </td>


              <td>

                <button
                  class="btn btn-sm btn-outline-secondary"
                  data-fa-copy="${index}"
                  title="Copy Secret"
                >

                  <i
                    class="bi bi-copy"
                  ></i>

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

              accounts[
                index
              ]
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


async function updateAccountOTPs() {

  await Promise.all(

    accounts.map(

      async (
        acc,
        index
      ) => {

        const el =
          document.querySelector(

            `[data-fa-otp="${index}"]`

          );


        if (!el) {

          return;
        }


        try {

          el.textContent =
            await generateOTP(
              acc
            );

        } catch {

          el.textContent =
            '------';
        }
      }

    )

  );
}


function startAccountTimer() {

  clearInterval(
    accountTimer
  );


  updateAccountOTPs();


  accountTimer =
    setInterval(

      updateAccountOTPs,

      1000

    );
}


/* =========================================================
   QR GENERATOR
========================================================= */

function normalizeQRText(value) {

  const input =
    String(
      value || ''
    ).trim();


  if (!input) {

    throw new Error(
      'Hãy nhập Secret hoặc otpauth://.'
    );
  }


  /*
   * Existing otpauth URI
   */
  if (
    input
      .toLowerCase()
      .startsWith(
        'otpauth://'
      )
  ) {

    const backup =
      {
        ...current
      };


    try {

      parseOTPAuth(
        input
      );

    } finally {

      current =
        backup;
    }


    return input;
  }


  /*
   * Base32
   */
  const secret =
    normalizeBase32(
      input
    );


  if (
    !isBase32(secret)
  ) {

    throw new Error(
      'Secret không phải Base32 hợp lệ.'
    );
  }


  return makeOtpAuth({

    secret,

    algorithm:
      'SHA1',

    digits:
      6,

    period:
      30,

    issuer:
      '2FA',

    account:
      '2FA',

    type:
      2,

    counter:
      0

  });
}


function generateQR(value) {

  if (
    typeof QRCode ===
    'undefined'
  ) {

    throw new Error(
      'QRCode library chưa được tải.'
    );
  }


  const text =
    normalizeQRText(
      value
    );


  const container =
    $('faQr');


  container.innerHTML =
    '';


  new QRCode(

    container,

    {

      text,

      width:
        220,

      height:
        220,

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
        container
          .querySelector(
            'canvas'
          );

    },

    80

  );
}


/* =========================================================
   PASTE
========================================================= */

function clipboardImage(event) {

  const clipboard =
    event.clipboardData;


  if (!clipboard) {

    return null;
  }


  /*
   * ClipboardItem
   */
  for (
    const item
    of clipboard.items ||
    []
  ) {

    if (
      String(
        item.type ||
        ''
      )
        .toLowerCase()
        .startsWith(
          'image/'
        )
    ) {

      const file =
        item.getAsFile();


      if (file) {

        return file;
      }
    }
  }


  /*
   * Files fallback
   */
  for (
    const file
    of clipboard.files ||
    []
  ) {

    if (
      String(
        file.type ||
        ''
      )
        .toLowerCase()
        .startsWith(
          'image/'
        )
    ) {

      return file;
    }
  }


  return null;
}


function pasteHandler(event) {

  if (
    !isTwoFAActive()
  ) {

    return;
  }


  /*
   * IMAGE FIRST
   */
  const file =
    clipboardImage(
      event
    );


  if (file) {

    event.preventDefault();

    event.stopPropagation();


    readQR(
      file
    );


    return;
  }


  /*
   * Nếu focus textarea/input
   * cho browser paste text bình thường.
   */
  const target =
    event.target;


  const isField =

    target instanceof
      HTMLInputElement ||

    target instanceof
      HTMLTextAreaElement ||

    target?.isContentEditable;


  if (isField) {

    return;
  }


  const text =
    event
      .clipboardData
      ?.getData(
        'text/plain'
      )
      ?.trim();


  if (!text) {

    return;
  }


  if (

    text.startsWith(
      'otpauth://'
    ) ||

    text.startsWith(
      'otpauth-migration://'
    )

  ) {

    event.preventDefault();


    try {

      handleQRText(
        text
      );

    } catch (error) {

      showStatus(

        'faStatus',

        error.message,

        'danger'

      );


      showStatus(

        'faMigrationStatus',

        error.message,

        'danger'

      );
    }
  }
}


function bindPasteOnce() {

  if (
    pasteBound
  ) {

    return;
  }


  /*
   * Capture phase:
   * bắt Ctrl+V trước textarea/input.
   */
  window.addEventListener(

    'paste',

    pasteHandler,

    true

  );


  pasteBound =
    true;
}


/* =========================================================
   RENDER
========================================================= */

export function render() {

  clearInterval(
    otpTimer
  );


  otpTimer =
    null;


  host().innerHTML = `

    <!-- HEADER -->

    <div
      class="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-4"
    >

      <div>

        <h4
          class="mb-1"
        >

          <i
            class="bi bi-shield-lock-fill text-primary me-2"
          ></i>

          2FA Authenticator

        </h4>


        <div
          class="small text-secondary"
        >

          QR, Secret và OTP chỉ xử lý trong trình duyệt.
          Không lưu localStorage.

        </div>

      </div>


      <span
        class="badge rounded-pill text-bg-success px-3 py-2"
      >

        <i
          class="bi bi-shield-check me-1"
        ></i>

        Local only

      </span>

    </div>


    <!-- TABS -->

    <ul
      class="nav nav-tabs mb-3"
    >

      <li
        class="nav-item"
      >

        <button
          class="nav-link active"
          data-bs-toggle="tab"
          data-bs-target="#faAuth"
          type="button"
        >

          <i
            class="bi bi-key-fill me-1"
          ></i>

          Authenticator

        </button>

      </li>


      <li
        class="nav-item"
      >

        <button
          class="nav-link"
          data-bs-toggle="tab"
          data-bs-target="#faMigration"
          type="button"
        >

          <i
            class="bi bi-qr-code-scan me-1"
          ></i>

          Google Migration

        </button>

      </li>

    </ul>


    <div
      class="tab-content"
    >


      <!-- AUTH -->

      <div
        class="tab-pane fade show active"
        id="faAuth"
      >

        <div
          id="faStatus"
          class="d-none"
        ></div>


        <div
          class="twofa-grid"
        >


          <!-- QR / SECRET -> OTP -->

          <div
            class="card p-3"
          >

            <div
              class="d-flex align-items-center gap-3 mb-3"
            >

              <div
                class="brand-logo"
              >

                <i
                  class="bi bi-camera-fill"
                ></i>

              </div>


              <div>

                <div
                  class="fw-semibold"
                >

                  QR / Secret → OTP

                </div>


                <div
                  class="small text-secondary"
                >

                  Ctrl+V ảnh QR, kéo thả hoặc chọn file

                </div>

              </div>

            </div>


            <div
              id="faDrop"
              class="qr-drop mb-3"
              tabindex="0"
            >

              <i
                class="bi bi-clipboard-plus fs-1 d-block mb-2"
              ></i>


              <div
                class="fw-semibold"
              >

                Ctrl + V ảnh QR

              </div>


              <div
                class="small text-secondary mt-1"
              >

                Hỗ trợ QR otpauth và Google Authenticator Export

              </div>


              <input
                id="faFile"
                type="file"
                accept="image/*"
                class="form-control form-control-sm mt-3"
              >

            </div>


            <textarea
              id="faInput"
              class="form-control code-font"
              rows="4"
              placeholder="Secret hoặc otpauth://"
            ></textarea>


            <div
              class="d-flex flex-wrap gap-2 mt-2"
            >

              <button
                id="faProcess"
                class="btn btn-primary btn-sm"
              >

                <i
                  class="bi bi-key me-1"
                ></i>

                Lấy mã

              </button>


              <button
                id="faCopyCode"
                class="btn btn-outline-secondary btn-sm"
              >

                <i
                  class="bi bi-copy me-1"
                ></i>

                Copy

              </button>


              <button
                id="faReset"
                class="btn btn-outline-danger btn-sm"
              >

                <i
                  class="bi bi-trash3 me-1"
                ></i>

                Xóa

              </button>

            </div>


            <div
              class="text-center mt-4"
            >

              <div
                class="small text-secondary"
              >

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


            <div
              class="row g-2 mt-3 small"
            >

              <div
                class="col-md-4"
              >

                <div
                  class="text-secondary"
                >
                  Account
                </div>

                <div
                  id="faAccount"
                  class="text-truncate"
                >
                  -
                </div>

              </div>


              <div
                class="col-md-4"
              >

                <div
                  class="text-secondary"
                >
                  Issuer
                </div>

                <div
                  id="faIssuer"
                  class="text-truncate"
                >
                  -
                </div>

              </div>


              <div
                class="col-md-4"
              >

                <div
                  class="text-secondary"
                >
                  Config
                </div>

                <div
                  id="faAlgo"
                >

                  TOTP · SHA1 · 6 digits · 30s

                </div>

              </div>

            </div>

          </div>


          <!-- SECRET -> QR -->

          <div
            class="card p-3"
          >

            <div
              class="d-flex align-items-center gap-3 mb-3"
            >

              <div
                class="brand-logo"
              >

                <i
                  class="bi bi-qr-code"
                ></i>

              </div>


              <div>

                <div
                  class="fw-semibold"
                >

                  Secret → QR

                </div>


                <div
                  class="small text-secondary"
                >

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


            <div
              class="d-flex gap-2 mt-2"
            >

              <button
                id="faQrGenerate"
                class="btn btn-primary btn-sm"
              >

                <i
                  class="bi bi-qr-code me-1"
                ></i>

                Tạo QR

              </button>


              <button
                id="faQrDownload"
                class="btn btn-outline-secondary btn-sm"
              >

                <i
                  class="bi bi-download me-1"
                ></i>

                PNG

              </button>

            </div>


            <div
              class="qr-preview mt-3"
            >

              <div
                id="faQr"
              ></div>

            </div>

          </div>

        </div>

      </div>


      <!-- GOOGLE MIGRATION -->

      <div
        class="tab-pane fade"
        id="faMigration"
      >

        <div
          id="faMigrationStatus"
          class="d-none"
        ></div>


        <div
          class="card p-3"
        >

          <div
            class="row g-4"
          >


            <!-- LEFT -->

            <div
              class="col-lg-4"
            >

              <div
                class="d-flex align-items-center gap-2 mb-2"
              >

                <i
                  class="bi bi-google fs-4 text-primary"
                ></i>


                <div>

                  <div
                    class="fw-semibold"
                  >

                    Google Authenticator Export

                  </div>


                  <div
                    class="small text-secondary"
                  >

                    Quét tuần tự tất cả QR nếu Google hiển thị nhiều trang

                  </div>

                </div>

              </div>


              <div
                id="faMigrationDrop"
                class="qr-drop mb-3"
                tabindex="0"
              >

                <i
                  class="bi bi-qr-code-scan fs-1 d-block mb-2"
                ></i>


                <div
                  class="fw-semibold"
                >

                  Ctrl+V / kéo / chọn QR Migration

                </div>


                <div
                  class="small text-secondary mt-1"
                >

                  Ví dụ QR 1/3 → 2/3 → 3/3

                </div>


                <input
                  id="faMigrationFile"
                  type="file"
                  accept="image/*"
                  class="form-control form-control-sm mt-3"
                >

              </div>


              <textarea
                id="faMigrationText"
                class="form-control code-font"
                rows="6"
                placeholder="otpauth-migration://offline?data=..."
              ></textarea>


              <div
                class="d-flex flex-wrap gap-2 mt-2"
              >

                <button
                  id="faDecodeMigration"
                  class="btn btn-primary btn-sm"
                >

                  <i
                    class="bi bi-cpu me-1"
                  ></i>

                  Giải mã chuỗi

                </button>


                <button
                  id="faCopyAll"
                  class="btn btn-outline-secondary btn-sm"
                >

                  <i
                    class="bi bi-copy me-1"
                  ></i>

                  Copy Secret

                </button>


                <button
                  id="faClearAccounts"
                  class="btn btn-outline-danger btn-sm"
                >

                  <i
                    class="bi bi-trash3 me-1"
                  ></i>

                  Xóa

                </button>

              </div>


              <!-- BATCH -->

              <div
                class="card surface-2 p-2 mt-3"
              >

                <div
                  class="section-title mb-2"
                >

                  Batch progress

                </div>


                <div
                  id="faBatchState"
                ></div>

              </div>

            </div>


            <!-- RIGHT -->

            <div
              class="col-lg-8"
            >

              <div
                class="d-flex justify-content-between align-items-center mb-2"
              >

                <strong>

                  Kết quả Migration

                </strong>


                <span
                  class="badge text-bg-secondary"
                >

                  <span
                    id="faAccountCount"
                  >
                    0
                  </span>

                  tài khoản

                </span>

              </div>


              <div
                class="table-responsive"
              >

                <table
                  class="table table-hover align-middle"
                >

                  <thead>

                    <tr>

                      <th>
                        Account
                      </th>

                      <th>
                        Issuer
                      </th>

                      <th>
                        Type
                      </th>

                      <th>
                        Secret
                      </th>

                      <th>
                        Algo
                      </th>

                      <th>
                        Digits
                      </th>

                      <th>
                        OTP
                      </th>

                      <th></th>

                    </tr>

                  </thead>


                  <tbody
                    id="faAccounts"
                  ></tbody>

                </table>

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;


  /* ======================================================
     AUTH EVENTS
  ====================================================== */

  $('faProcess').onclick =
    () => {

      try {

        parseOTPAuth(
          $('faInput').value
        );


        $('faQrInput')
          .value =
          $('faInput').value;


        updateInfo();

        startOTP();


        showStatus(

          'faStatus',

          '✓ Đã nhận Secret.',

          'success'

        );

      } catch (error) {

        showStatus(

          'faStatus',

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

        return toast(
          'Chưa có OTP.',
          'warning'
        );
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
    () => {

      current = {

        secret:
          '',

        algorithm:
          'SHA1',

        digits:
          6,

        period:
          30,

        issuer:
          '',

        account:
          '',

        type:
          2,

        counter:
          0

      };


      clearInterval(
        otpTimer
      );


      render();
    };


  /* ======================================================
     FILE INPUT
  ====================================================== */

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


  $('faMigrationFile').onchange =
    event => {

      readQR(

        event
          .target
          .files?.[0]

      );


      event.target.value =
        '';
    };


  /* ======================================================
     DRAG DROP
  ====================================================== */

  const bindDrop =
    element => {


      [
        'dragenter',
        'dragover'
      ].forEach(

        name => {

          element.addEventListener(

            name,

            event => {

              event.preventDefault();


              element
                .classList
                .add(
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

        name => {

          element.addEventListener(

            name,

            event => {

              event.preventDefault();


              element
                .classList
                .remove(
                  'drag'
                );
            }

          );
        }

      );


      element.addEventListener(

        'drop',

        event => {

          const file =

            [
              ...(
                event
                  .dataTransfer
                  ?.files ||
                []
              )
            ]
              .find(

                file =>

                  String(
                    file.type ||
                    ''
                  )
                    .startsWith(
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
    };


  bindDrop(
    $('faDrop')
  );


  bindDrop(
    $('faMigrationDrop')
  );


  /* ======================================================
     QR GENERATOR
  ====================================================== */

  $('faQrGenerate').onclick =
    () => {

      try {

        generateQR(
          $('faQrInput').value
        );


        showStatus(

          'faStatus',

          '✓ Đã tạo QR.',

          'success'

        );

      } catch (error) {

        showStatus(

          'faStatus',

          error.message,

          'danger'

        );
      }
    };


  $('faQrDownload').onclick =
    () => {

      const canvas =

        qrCanvas ||

        $('faQr')
          .querySelector(
            'canvas'
          );


      if (!canvas) {

        return toast(
          'Chưa có QR.',
          'warning'
        );
      }


      const link =
        document.createElement(
          'a'
        );


      link.download =
        '2FA-QR.png';


      link.href =
        canvas.toDataURL(
          'image/png'
        );


      link.click();
    };


  /* ======================================================
     MIGRATION EVENTS
  ====================================================== */

  $('faDecodeMigration').onclick =
    () => {

      try {

        const result =
          decodeMigration(

            $('faMigrationText')
              .value
              .trim()

          );


        const pageNo =

          result
            .payload
            .batchIndex +

          1;


        showStatus(

          'faMigrationStatus',

          `✓ QR ${
            pageNo
          }/${
            result.payload.batchSize
          }: thêm ${
            result.added
          } tài khoản. ${
            batchProgressText(
              result.batch
            )
          }`,

          result.complete
            ? 'success'
            : 'info'

        );

      } catch (error) {

        showStatus(

          'faMigrationStatus',

          `Lỗi giải mã: ${
            error.message
          }`,

          'danger'

        );
      }
    };


  $('faCopyAll').onclick =
    async () => {

      if (
        !accounts.length
      ) {

        return toast(
          'Chưa có tài khoản.',
          'warning'
        );
      }


      await copyText(

        accounts
          .map(

            acc =>

              `${
                acc.issuer ||
                'Account'
              }: ${
                acc.account ||
                acc.name ||
                '-'
              } - ${
                acc.secret
              }`

          )
          .join(
            '\n'
          )

      );


      toast(

        'Đã copy tất cả Secret.',

        'success'

      );
    };


  $('faClearAccounts').onclick =
    () => {

      accounts =
        [];


      migrationBatches
        .clear();


      clearInterval(
        accountTimer
      );


      renderAccounts();

      renderBatchState();


      hideStatus(
        'faMigrationStatus'
      );
    };


  /* ======================================================
     RESTORE RUNTIME
  ====================================================== */

  renderAccounts();

  renderBatchState();


  if (
    accounts.length
  ) {

    startAccountTimer();
  }


  if (
    current.secret
  ) {

    $('faInput')
      .value =
      makeOtpAuth(
        current
      );


    $('faQrInput')
      .value =
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

    bindPasteOnce();

  },

  render

};
