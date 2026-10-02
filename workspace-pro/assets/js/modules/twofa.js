import {
  esc,
  toast,
  copyText
} from '../utils.js';


/* =========================================================
   2FA MODULE
   - QR image -> OTP
   - Secret -> OTP
   - otpauth:// -> OTP
   - Secret / otpauth:// -> QR
   - Google Authenticator Migration QR
   - Ctrl + V image
   - Drag & Drop
   - NO localStorage
========================================================= */


const host = () =>
  document.getElementById('module-twofa');


const $ = id =>
  document.getElementById(id);


/* =========================================================
   STATE
========================================================= */


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

let accountOtpTimer = null;

let qrCanvas = null;

let pasteBound = false;


/* =========================================================
   BASIC HELPERS
========================================================= */


function isTwoFAActive() {

  const element = host();

  return Boolean(
    element &&
    element.classList.contains('active')
  );

}


function normalizeBase32(value) {

  return String(value || '')

    .toUpperCase()

    .replace(/\s+/g, '')

    .replace(/-/g, '')

    .replace(/=/g, '');

}


function isValidBase32(value) {

  return (
    Boolean(value) &&
    /^[A-Z2-7]+$/.test(value)
  );

}


function bytesToBase32(buffer) {

  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

  let bits = 0;

  let value = 0;

  let output = '';


  for (const byte of buffer) {

    value =
      (value << 8) |
      byte;

    bits += 8;


    while (bits >= 5) {

      output +=
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

    output +=
      alphabet[
        (
          value <<
          (5 - bits)
        ) & 31
      ];

  }


  return output;

}


function base64UrlToBytes(value) {

  let text =
    String(value || '')

      // URLSearchParams đôi khi đổi + thành space
      .replace(/ /g, '+')

      .replace(/-/g, '+')

      .replace(/_/g, '/');


  while (
    text.length % 4
  ) {

    text += '=';

  }


  const raw =
    atob(text);


  return Uint8Array.from(

    raw,

    char =>
      char.charCodeAt(0)

  );

}


/* =========================================================
   STATUS
========================================================= */


function showStatus(
  message,
  type = 'info'
) {

  const element =
    $('faStatus');


  if (!element) {

    return;

  }


  const className = {

    success:
      'alert-success',

    danger:
      'alert-danger',

    warning:
      'alert-warning',

    info:
      'alert-info'

  }[type] ||
    'alert-info';


  element.className =
    `alert ${className} py-2 px-3 mb-3`;


  element.textContent =
    message;


  element.classList.remove(
    'd-none'
  );

}


function clearStatus() {

  const element =
    $('faStatus');


  if (!element) {

    return;

  }


  element.textContent =
    '';


  element.classList.add(
    'd-none'
  );

}


/* =========================================================
   NATIVE OTPAUTH PARSER
   Không dùng OTPAuth.URI.parse()
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


  /* -------------------------------------------------------
     Secret Base32 thuần
  ------------------------------------------------------- */

  if (
    !value
      .toLowerCase()
      .startsWith(
        'otpauth://'
      )
  ) {

    const secret =
      normalizeBase32(
        value
      );


    if (
      !isValidBase32(
        secret
      )
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
        ''

    };


    return current;

  }


  /* -------------------------------------------------------
     Parse otpauth:// bằng URL native
  ------------------------------------------------------- */

  let url;


  try {

    url =
      new URL(value);

  } catch {

    throw new Error(
      'otpauth:// không hợp lệ.'
    );

  }


  const type =
    String(
      url.hostname || ''
    ).toLowerCase();


  if (
    type !== 'totp'
  ) {

    throw new Error(
      'Hiện tại chỉ hỗ trợ TOTP.'
    );

  }


  /* -------------------------------------------------------
     SECRET
  ------------------------------------------------------- */

  const secret =
    normalizeBase32(

      url
        .searchParams
        .get('secret')

    );


  if (!secret) {

    throw new Error(
      'Không tìm thấy Secret trong QR.'
    );

  }


  if (
    !isValidBase32(
      secret
    )
  ) {

    throw new Error(
      'Secret trong QR không phải Base32 hợp lệ.'
    );

  }


  /* -------------------------------------------------------
     LABEL
  ------------------------------------------------------- */

  let label =
    url.pathname
      .replace(/^\/+/, '');


  try {

    label =
      decodeURIComponent(
        label
      );

  } catch {

    // Nếu decode lỗi thì giữ nguyên

  }


  /* -------------------------------------------------------
     ISSUER + ACCOUNT
  ------------------------------------------------------- */

  let issuer =

    url
      .searchParams
      .get('issuer') ||

    '';


  let account =
    label;


  const colonIndex =
    label.indexOf(':');


  if (
    colonIndex !== -1
  ) {

    const labelIssuer =
      label
        .slice(
          0,
          colonIndex
        )
        .trim();


    const labelAccount =
      label
        .slice(
          colonIndex + 1
        )
        .trim();


    if (!issuer) {

      issuer =
        labelIssuer;

    }


    account =
      labelAccount;

  }


  /* -------------------------------------------------------
     ALGORITHM
  ------------------------------------------------------- */

  let algorithm =
    String(

      url
        .searchParams
        .get('algorithm') ||

      'SHA1'

    ).toUpperCase();


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


  /* -------------------------------------------------------
     DIGITS
  ------------------------------------------------------- */

  let digits =
    Number(

      url
        .searchParams
        .get('digits') ||

      6

    );


  if (
    digits !== 6 &&
    digits !== 8
  ) {

    digits =
      6;

  }


  /* -------------------------------------------------------
     PERIOD
  ------------------------------------------------------- */

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


  current = {

    secret,

    algorithm,

    digits,

    period,

    issuer,

    account

  };


  return current;

}


/* =========================================================
   CREATE OTPAUTH URI
========================================================= */


function makeOtpAuth(account) {

  const issuer =
    String(
      account.issuer ||
      '2FA'
    );


  const accountName =
    String(
      account.account ||
      '2FA'
    );


  const label =
    encodeURIComponent(

      `${issuer}:${accountName}`

    );


  return (

    `otpauth://totp/${label}` +

    `?secret=${
      encodeURIComponent(
        account.secret
      )
    }` +

    `&issuer=${
      encodeURIComponent(
        issuer
      )
    }` +

    `&algorithm=${
      encodeURIComponent(
        account.algorithm ||
        'SHA1'
      )
    }` +

    `&digits=${
      encodeURIComponent(
        account.digits ||
        6
      )
    }` +

    `&period=${
      encodeURIComponent(
        account.period ||
        30
      )
    }`

  );

}


/* =========================================================
   BASE32 -> BYTES
========================================================= */


function base32ToBytes(
  secret
) {

  secret =
    normalizeBase32(
      secret
    );


  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';


  let bits =
    '';


  const bytes =
    [];


  for (
    const char
    of secret
  ) {

    const index =
      alphabet.indexOf(
        char
      );


    if (
      index === -1
    ) {

      throw new Error(
        'Secret Base32 không hợp lệ.'
      );

    }


    bits +=
      index
        .toString(2)
        .padStart(
          5,
          '0'
        );

  }


  for (

    let i = 0;

    i + 8 <=
    bits.length;

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


/* =========================================================
   TOTP
========================================================= */


async function generateTOTP(
  account = current
) {

  if (
    !account.secret
  ) {

    throw new Error(
      'Không có Secret.'
    );

  }


  const keyBytes =
    base32ToBytes(
      account.secret
    );


  const algorithm =
    String(
      account.algorithm ||
      'SHA1'
    ).toUpperCase();


  let hashName;


  switch (
    algorithm
  ) {

    case 'SHA256':

      hashName =
        'SHA-256';

      break;


    case 'SHA512':

      hashName =
        'SHA-512';

      break;


    default:

      hashName =
        'SHA-1';

  }


  const period =
    Number(
      account.period
    ) || 30;


  const counter =
    Math.floor(

      Date.now() /
      1000 /
      period

    );


  const counterBytes =
    new Uint8Array(8);


  let value =
    counter;


  for (

    let i = 7;

    i >= 0;

    i--

  ) {

    counterBytes[i] =
      value & 255;


    value =
      Math.floor(
        value / 256
      );

  }


  const key =
    await crypto.subtle.importKey(

      'raw',

      keyBytes,

      {

        name:
          'HMAC',

        hash:
          hashName

      },

      false,

      ['sign']

    );


  const signature =
    await crypto.subtle.sign(

      'HMAC',

      key,

      counterBytes

    );


  const hash =
    new Uint8Array(
      signature
    );


  const offset =
    hash[
      hash.length - 1
    ] & 0x0f;


  const binary = (

    (
      (
        hash[offset] &
        0x7f
      ) << 24
    ) |

    (
      (
        hash[
          offset + 1
        ] &
        0xff
      ) << 16
    ) |

    (
      (
        hash[
          offset + 2
        ] &
        0xff
      ) << 8
    ) |

    (
      hash[
        offset + 3
      ] &
      0xff
    )

  ) >>> 0;


  const digits =
    Number(
      account.digits
    ) || 6;


  const otp =
    binary %
    Math.pow(
      10,
      digits
    );


  return String(
    otp
  ).padStart(
    digits,
    '0'
  );

}


/* =========================================================
   CURRENT OTP UI
========================================================= */


function updateCurrentInfo() {

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

    `${current.algorithm} · ${current.digits} digits · ${current.period}s`;

}


async function updateCurrentOTP() {

  if (
    !current.secret
  ) {

    return;

  }


  try {

    const code =
      await generateTOTP(
        current
      );


    const period =
      Number(
        current.period
      ) || 30;


    const now =
      Math.floor(
        Date.now() /
        1000
      );


    const remaining =
      period -
      (
        now %
        period
      );


    if (
      $('faCode')
    ) {

      $('faCode')
        .textContent =
        code;

    }


    if (
      $('faTimer')
    ) {

      $('faTimer')
        .textContent =

        `Mã mới sau ${remaining} giây`;

    }


    if (
      $('faProgress')
    ) {

      $('faProgress')
        .style.width =

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


function startCurrentOtpTimer() {

  clearInterval(
    otpTimer
  );


  updateCurrentOTP();


  otpTimer =
    setInterval(

      updateCurrentOTP,

      1000

    );

}


/* =========================================================
   CLIPBOARD IMAGE
========================================================= */


function getClipboardImage(
  event
) {

  const clipboard =
    event.clipboardData;


  if (!clipboard) {

    return null;

  }


  /*
   * Cách giống code cũ
   * đã chạy được của bạn.
   */
  if (
    clipboard.items
  ) {

    for (
      const item
      of clipboard.items
    ) {

      const type =
        String(
          item.type ||
          ''
        ).toLowerCase();


      if (
        type.startsWith(
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

  }


  /*
   * Fallback
   */
  if (
    clipboard.files
  ) {

    for (
      const file
      of clipboard.files
    ) {

      const type =
        String(
          file.type ||
          ''
        ).toLowerCase();


      if (
        type.startsWith(
          'image/'
        )
      ) {

        return file;

      }

    }

  }


  return null;

}


/* =========================================================
   IMAGE -> IMAGE DATA
========================================================= */


async function imageFileToData(
  file
) {

  if (!file) {

    throw new Error(
      'Không tìm thấy ảnh.'
    );

  }


  /* -------------------------------------------------------
     createImageBitmap
  ------------------------------------------------------- */

  if (
    'createImageBitmap'
    in window
  ) {

    try {

      const bitmap =
        await createImageBitmap(
          file
        );


      const maxSize =
        4000;


      let width =
        bitmap.width;


      let height =
        bitmap.height;


      if (

        Math.max(
          width,
          height
        ) >
        maxSize

      ) {

        const scale =

          maxSize /

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


      const context =
        canvas.getContext(

          '2d',

          {
            willReadFrequently:
              true
          }

        );


      context.drawImage(

        bitmap,

        0,
        0,

        width,
        height

      );


      if (
        bitmap.close
      ) {

        bitmap.close();

      }


      return context.getImageData(

        0,
        0,

        width,
        height

      );

    } catch {

      // fallback

    }

  }


  /* -------------------------------------------------------
     FileReader fallback
  ------------------------------------------------------- */

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

              const maxSize =
                4000;


              let width =
                image.naturalWidth;


              let height =
                image.naturalHeight;


              if (

                Math.max(
                  width,
                  height
                ) >
                maxSize

              ) {

                const scale =

                  maxSize /

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


              const context =
                canvas.getContext(

                  '2d',

                  {
                    willReadFrequently:
                      true
                  }

                );


              context.drawImage(

                image,

                0,
                0,

                width,
                height

              );


              resolve(

                context.getImageData(

                  0,
                  0,

                  width,
                  height

                )

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


/* =========================================================
   QR READER
========================================================= */


async function readQR(
  file
) {

  try {

    if (
      typeof jsQR ===
      'undefined'
    ) {

      throw new Error(
        'jsQR chưa được tải.'
      );

    }


    showStatus(
      'Đang đọc QR...',
      'info'
    );


    const imageData =
      await imageFileToData(
        file
      );


    const result =
      jsQR(

        imageData.data,

        imageData.width,

        imageData.height,

        {
          inversionAttempts:
            'attemptBoth'
        }

      );


    if (
      !result ||
      !result.data
    ) {

      throw new Error(
        'Không tìm thấy QR trong ảnh.'
      );

    }


    handleQRText(
      result.data
    );


    showStatus(
      '✓ Đã đọc QR thành công.',
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


/* =========================================================
   HANDLE QR CONTENT
========================================================= */


function handleQRText(
  text
) {

  text =
    String(text || '')
      .trim();


  if (
    !text
  ) {

    throw new Error(
      'QR không có dữ liệu.'
    );

  }


  /* -------------------------------------------------------
     GOOGLE MIGRATION
  ------------------------------------------------------- */

  if (
    text.startsWith(
      'otpauth-migration://'
    )
  ) {

    decodeMigration(
      text
    );


    const button =
      document.querySelector(

        '[data-bs-target="#faMigration"]'

      );


    if (button) {

      bootstrap.Tab
        .getOrCreateInstance(
          button
        )
        .show();

    }


    return;

  }


  /* -------------------------------------------------------
     NORMAL TOTP
  ------------------------------------------------------- */

  if (
    text.startsWith(
      'otpauth://'
    )
  ) {

    parseOTPAuth(
      text
    );


    if (
      $('faInput')
    ) {

      $('faInput')
        .value =
        text;

    }


    if (
      $('faQrInput')
    ) {

      $('faQrInput')
        .value =
        text;

    }


    updateCurrentInfo();

    startCurrentOtpTimer();


    return;

  }


  /* -------------------------------------------------------
     QR chứa Secret Base32 thuần
  ------------------------------------------------------- */

  const secret =
    normalizeBase32(
      text
    );


  if (
    isValidBase32(
      secret
    )
  ) {

    parseOTPAuth(
      secret
    );


    if (
      $('faInput')
    ) {

      $('faInput')
        .value =
        secret;

    }


    if (
      $('faQrInput')
    ) {

      $('faQrInput')
        .value =
        secret;

    }


    updateCurrentInfo();

    startCurrentOtpTimer();


    return;

  }


  throw new Error(
    'QR không chứa dữ liệu 2FA hợp lệ.'
  );

}


/* =========================================================
   GLOBAL PASTE HANDLER
========================================================= */


function globalPasteHandler(
  event
) {

  /*
   * Chỉ hoạt động khi tab
   * 2FA đang active.
   */
  if (
    !isTwoFAActive()
  ) {

    return;

  }


  /* -------------------------------------------------------
     IMAGE FIRST
  ------------------------------------------------------- */

  const image =
    getClipboardImage(
      event
    );


  if (image) {

    event.preventDefault();

    event.stopPropagation();


    readQR(
      image
    );


    return;

  }


  /* -------------------------------------------------------
     Nếu đang focus input
     thì cho browser paste text
     bình thường.
  ------------------------------------------------------- */

  const target =
    event.target;


  const isInput =

    target instanceof
      HTMLInputElement ||

    target instanceof
      HTMLTextAreaElement ||

    target?.isContentEditable;


  if (isInput) {

    return;

  }


  /* -------------------------------------------------------
     Paste otpauth text
  ------------------------------------------------------- */

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


  /* -------------------------------------------------------
     Already otpauth://
  ------------------------------------------------------- */

  if (
    value
      .toLowerCase()
      .startsWith(
        'otpauth://'
      )
  ) {

    /*
     * Validate bằng parser
     * của chính mình.
     */

    const oldCurrent =
      {
        ...current
      };


    try {

      parseOTPAuth(
        value
      );

    } finally {

      current =
        oldCurrent;

    }


    return value;

  }


  /* -------------------------------------------------------
     Base32 Secret
  ------------------------------------------------------- */

  const secret =
    normalizeBase32(
      value
    );


  if (
    !isValidBase32(
      secret
    )
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
      '2FA'

  });

}


function generateQR(
  value
) {

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


  if (!container) {

    return;

  }


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

    100

  );

}


/* =========================================================
   MIGRATION PROTOBUF
========================================================= */


/* =========================================================
   GOOGLE AUTHENTICATOR MIGRATION
========================================================= */

function parseMigrationQR(uri) {

  uri = String(uri || '').trim();

  if (
    !uri.startsWith(
      'otpauth-migration://offline?data='
    )
  ) {
    throw new Error(
      'Không phải Google Authenticator Migration QR.'
    );
  }


  /*
   * KHÔNG dùng new URL() / URLSearchParams ở đây.
   *
   * Payload Migration là Base64 nằm thẳng
   * sau data=. Lấy nguyên chuỗi giống code cũ.
   */
  let encoded =
    uri.split('data=')[1];


  if (!encoded) {
    throw new Error(
      'Migration QR không có payload.'
    );
  }


  /*
   * Nếu URI có thêm & ở cuối
   * chỉ lấy đúng parameter data.
   */
  encoded =
    encoded.split('&')[0];


  /*
   * Google có thể percent-encode:
   *
   * %2B = +
   * %2F = /
   * %3D = =
   */
  try {

    encoded =
      decodeURIComponent(
        encoded
      );

  } catch {
    // giữ nguyên nếu decodeURIComponent lỗi
  }


  /*
   * Một số browser biến dấu + thành space.
   */
  encoded =
    encoded.replace(
      / /g,
      '+'
    );


  /*
   * Hỗ trợ cả Base64URL nếu gặp.
   */
  encoded =
    encoded
      .replace(/-/g, '+')
      .replace(/_/g, '/');


  /*
   * Bổ sung padding Base64.
   */
  while (
    encoded.length % 4
  ) {

    encoded += '=';

  }


  let binary;

  try {

    binary =
      atob(encoded);

  } catch (error) {

    console.error(
      'Migration base64:',
      encoded,
      error
    );

    throw new Error(
      'Không giải mã được Base64 của Migration QR.'
    );
  }


  const bytes =
    Uint8Array.from(

      binary,

      char =>
        char.charCodeAt(0)

    );


  return parseMigrationBytes(
    bytes
  );
}


/* =========================================================
   MIGRATION PAYLOAD PROTOBUF
========================================================= */

function parseMigrationBytes(bytes) {

  let offset = 0;

  const accounts = [];


  function readVarint() {

    let result = 0;

    let shift = 0;


    while (
      offset <
      bytes.length
    ) {

      const byte =
        bytes[offset++];


      result +=
        (
          byte & 0x7f
        ) *
        Math.pow(
          2,
          shift
        );


      if (
        !(byte & 0x80)
      ) {
        return result;
      }


      shift += 7;


      if (
        shift > 56
      ) {

        throw new Error(
          'Protobuf varint không hợp lệ.'
        );
      }

    }


    throw new Error(
      'Payload protobuf bị thiếu dữ liệu.'
    );
  }


  function skipField(wireType) {

    /*
     * VARINT
     */
    if (
      wireType === 0
    ) {

      readVarint();

      return;
    }


    /*
     * 64-bit
     */
    if (
      wireType === 1
    ) {

      offset += 8;

      return;
    }


    /*
     * LENGTH DELIMITED
     */
    if (
      wireType === 2
    ) {

      const length =
        readVarint();

      offset +=
        length;

      return;
    }


    /*
     * 32-bit
     */
    if (
      wireType === 5
    ) {

      offset += 4;

      return;
    }


    throw new Error(
      `Wire type protobuf không hỗ trợ: ${wireType}`
    );
  }


  while (
    offset <
    bytes.length
  ) {

    const tag =
      readVarint();


    const field =
      Math.floor(
        tag / 8
      );


    const wire =
      tag % 8;


    /*
     * MigrationPayload:
     *
     * field 1 =
     * repeated OtpParameters
     */
    if (
      field === 1 &&
      wire === 2
    ) {

      const length =
        readVarint();


      const end =
        offset +
        length;


      if (
        end >
        bytes.length
      ) {

        throw new Error(
          'OtpParameters vượt quá kích thước payload.'
        );
      }


      const sub =
        bytes.slice(
          offset,
          end
        );


      offset =
        end;


      const account =
        parseOtpParameters(
          sub
        );


      if (account) {

        accounts.push(
          account
        );

      }


      continue;
    }


    /*
     * Các field còn lại:
     *
     * version
     * batch_size
     * batch_index
     * batch_id
     *
     * chỉ cần skip.
     */
    skipField(
      wire
    );

  }


  return accounts;
}


/* =========================================================
   OTP PARAMETERS
========================================================= */

function parseOtpParameters(bytes) {

  let offset = 0;


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
    0;


  function readVarint() {

    let result = 0;

    let shift = 0;


    while (
      offset <
      bytes.length
    ) {

      const byte =
        bytes[offset++];


      result +=
        (
          byte & 0x7f
        ) *
        Math.pow(
          2,
          shift
        );


      if (
        !(byte & 0x80)
      ) {

        return result;

      }


      shift += 7;


      if (
        shift > 56
      ) {

        throw new Error(
          'OtpParameters varint không hợp lệ.'
        );
      }

    }


    throw new Error(
      'OtpParameters bị thiếu dữ liệu.'
    );
  }


  function readBytes() {

    const length =
      readVarint();


    const end =
      offset +
      length;


    if (
      end >
      bytes.length
    ) {

      throw new Error(
        'Length-delimited field không hợp lệ.'
      );
    }


    const result =
      bytes.slice(
        offset,
        end
      );


    offset =
      end;


    return result;
  }


  function readString() {

    return new TextDecoder()
      .decode(
        readBytes()
      );

  }


  function skipField(wireType) {

    if (
      wireType === 0
    ) {

      readVarint();

      return;
    }


    if (
      wireType === 1
    ) {

      offset += 8;

      return;
    }


    if (
      wireType === 2
    ) {

      readBytes();

      return;
    }


    if (
      wireType === 5
    ) {

      offset += 4;

      return;
    }


    throw new Error(
      `OtpParameters wire type không hỗ trợ: ${wireType}`
    );
  }


  while (
    offset <
    bytes.length
  ) {

    const tag =
      readVarint();


    const field =
      Math.floor(
        tag / 8
      );


    const wire =
      tag % 8;


    switch (
      field
    ) {

      /*
       * bytes secret = 1
       */
      case 1:

        if (
          wire !== 2
        ) {

          throw new Error(
            'Secret protobuf không hợp lệ.'
          );

        }


        secretBytes =
          readBytes();

        break;


      /*
       * string name = 2
       */
      case 2:

        name =
          readString();

        break;


      /*
       * string issuer = 3
       */
      case 3:

        issuer =
          readString();

        break;


      /*
       * Algorithm algorithm = 4
       */
      case 4:

        algorithm =
          readVarint();

        break;


      /*
       * DigitCount digits = 5
       */
      case 5:

        digits =
          readVarint();

        break;


      /*
       * OtpType type = 6
       */
      case 6:

        type =
          readVarint();

        break;


      /*
       * int64 counter = 7
       */
      case 7:

        counter =
          readVarint();

        break;


      default:

        skipField(
          wire
        );

    }

  }


  if (
    !secretBytes ||
    !secretBytes.length
  ) {

    return null;

  }


  const algorithmMap = {

    0:
      'SHA1',

    1:
      'SHA1',

    2:
      'SHA256',

    3:
      'SHA512',

    4:
      'MD5'

  };


  const digitMap = {

    0:
      6,

    1:
      6,

    2:
      8

  };


  return {

    name,

    account:
      name,

    issuer,

    secret:
      bytesToBase32(
        secretBytes
      ),

    algorithm:
      algorithmMap[
        algorithm
      ] ||
      'SHA1',

    digits:
      digitMap[
        digits
      ] ||
      6,

    period:
      30,

    type,

    counter

  };
}


/* =========================================================
   DECODE MIGRATION
========================================================= */

function decodeMigration(uri) {

  const result =
    parseMigrationQR(
      uri
    );


  if (
    !result.length
  ) {

    throw new Error(
      'Migration QR hợp lệ nhưng không tìm thấy tài khoản.'
    );
  }


  /*
   * Hiện app chỉ tạo OTP cho TOTP.
   *
   * Google enum:
   * 1 = HOTP
   * 2 = TOTP
   *
   * Nếu type = 0 thì vẫn giữ để tương thích
   * với payload cũ.
   */
  const supported =
    result.filter(
      account =>
        account.type === 0 ||
        account.type === 2
    );


  const unsupported =
    result.length -
    supported.length;


  accounts = [
    ...accounts,
    ...supported
  ];


  if (
    $('faMigText')
  ) {

    $('faMigText').value =
      uri;

  }


  renderMigrationAccounts();


  startAccountOtpTimer();


  let message =
    `✓ Đã giải mã ${supported.length} tài khoản.`;


  if (
    unsupported > 0
  ) {

    message +=
      ` Bỏ qua ${unsupported} HOTP.`;

  }


  showStatus(
    message,
    'success'
  );
}


  accounts = [

    ...accounts,

    ...result

  ];


  if (
    $('faMigText')
  ) {

    $('faMigText').value =
      uri;

  }


  renderMigrationAccounts();


  startAccountOtpTimer();


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


  if (
    !accounts.length
  ) {

    body.innerHTML = `

      <tr>

        <td
          colspan="6"
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
          account,
          index
        ) => {

          let code =
            '------';


          try {

            code =
              await generateTOTP(
                account
              );

          } catch {

            // ignore

          }


          return `

            <tr>

              <td>
                ${esc(
                  account.account ||
                  '-'
                )}
              </td>

              <td>
                ${esc(
                  account.issuer ||
                  '-'
                )}
              </td>

              <td>

                <code>
                  ${esc(
                    account.secret
                  )}
                </code>

              </td>

              <td>
                ${esc(
                  account.algorithm
                )}
              </td>

              <td
                class="code-font fw-bold text-success"
                data-account-otp="${index}"
              >
                ${esc(code)}
              </td>

              <td>

                <button
                  class="btn btn-sm btn-outline-secondary"
                  data-copy-secret="${index}"
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
      '[data-copy-secret]'
    )
    .forEach(

      button => {

        button.onclick =
          async () => {

            const index =
              Number(

                button
                  .dataset
                  .copySecret

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


async function updateAccountOtps() {

  for (

    let index = 0;

    index <
    accounts.length;

    index++

  ) {

    const element =

      document.querySelector(

        `[data-account-otp="${index}"]`

      );


    if (!element) {

      continue;

    }


    try {

      element.textContent =

        await generateTOTP(

          accounts[index]

        );

    } catch {

      element.textContent =
        '------';

    }

  }

}


function startAccountOtpTimer() {

  clearInterval(
    accountOtpTimer
  );


  updateAccountOtps();


  accountOtpTimer =

    setInterval(

      updateAccountOtps,

      1000

    );

}


/* =========================================================
   RESET
========================================================= */


function resetCurrent() {

  clearInterval(
    otpTimer
  );


  otpTimer =
    null;


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
      ''

  };


  render();

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

        <h4 class="mb-1">

          <i
            class="bi bi-shield-lock-fill text-primary me-2"
          ></i>

          2FA Authenticator

        </h4>

        <div
          class="small text-secondary"
        >

          QR, Secret và OTP chỉ được xử lý trong trình duyệt.

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


    <!-- STATUS -->

    <div
      id="faStatus"
      class="d-none"
    ></div>


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

          Migration QR

        </button>

      </li>

    </ul>


    <div
      class="tab-content"
    >


      <!-- ================================================
           AUTH TAB
      ================================================= -->

      <div
        class="tab-pane fade show active"
        id="faAuth"
      >

        <div
          class="twofa-grid"
        >


          <!-- QR -> OTP -->

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

                  Ctrl + V ảnh QR ở bất kỳ đâu

                </div>

              </div>

            </div>


            <!-- DROP -->

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

                hoặc kéo ảnh vào đây

              </div>


              <div
                class="small text-secondary"
              >

                PNG · JPG · WEBP

              </div>


              <input
                id="faFile"
                type="file"
                accept="image/*"
                class="form-control form-control-sm mt-3"
              >

            </div>


            <!-- SECRET -->

            <textarea
              id="faInput"
              class="form-control code-font"
              rows="4"
              placeholder="Secret hoặc otpauth://"
            ></textarea>


            <!-- BUTTONS -->

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


            <!-- OTP -->

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


            <!-- INFO -->

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
                  SHA1 · 6 digits · 30s
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

                  Tạo lại QR Authenticator

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


      <!-- ================================================
           MIGRATION
      ================================================= -->

      <div
        class="tab-pane fade"
        id="faMigration"
      >

        <div
          class="card p-3"
        >

          <div
            class="row g-4"
          >


            <div
              class="col-lg-4"
            >

              <h6>

                <i
                  class="bi bi-qr-code-scan me-2"
                ></i>

                Google Authenticator Migration

              </h6>


              <p
                class="small text-secondary"
              >

                Ctrl + V ảnh Migration QR hoặc chọn file.

              </p>


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


              <div
                class="d-flex gap-2 mt-2"
              >

                <button
                  id="faMigDecode"
                  class="btn btn-primary btn-sm"
                >

                  <i
                    class="bi bi-cpu me-1"
                  ></i>

                  Giải mã

                </button>


                <button
                  id="faMigClear"
                  class="btn btn-outline-danger btn-sm"
                >

                  <i
                    class="bi bi-trash3 me-1"
                  ></i>

                  Xóa

                </button>

              </div>

            </div>


            <div
              class="col-lg-8"
            >

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
                        Secret
                      </th>

                      <th>
                        Algo
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


        $('faQrInput').value =
          $('faInput').value;


        updateCurrentInfo();

        startCurrentOtpTimer();

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
        code ===
        '------'
      ) {

        toast(
          'Chưa có OTP.',
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


  /* ======================================================
     FILE
  ====================================================== */


  $('faFile').onchange =
    event => {

      const file =
        event
          .target
          .files?.[0];


      if (file) {

        readQR(file);

      }


      event.target.value =
        '';

    };


  $('faMigFile').onchange =
    event => {

      const file =
        event
          .target
          .files?.[0];


      if (file) {

        readQR(file);

      }


      event.target.value =
        '';

    };


  /* ======================================================
     DRAG / DROP
  ====================================================== */


  const dropZone =
    $('faDrop');


  [
    'dragenter',
    'dragover'
  ].forEach(

    eventName => {

      dropZone.addEventListener(

        eventName,

        event => {

          event.preventDefault();


          dropZone
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

    eventName => {

      dropZone.addEventListener(

        eventName,

        event => {

          event.preventDefault();


          dropZone
            .classList
            .remove(
              'drag'
            );

        }

      );

    }

  );


  dropZone.addEventListener(

    'drop',

    event => {

      const file =
        Array
          .from(
            event
              .dataTransfer
              .files
          )
          .find(

            file =>

              String(
                file.type
              )
                .toLowerCase()
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
          '✓ Đã tạo QR.',
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
        qrCanvas
          .toDataURL(
            'image/png'
          );


      link.click();

    };


  /* ======================================================
     MIGRATION
  ====================================================== */


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

      accounts =
        [];


      $('faMigText').value =
        '';


      renderMigrationAccounts();


      clearInterval(
        accountOtpTimer
      );

    };


  renderMigrationAccounts();


  if (
    accounts.length
  ) {

    startAccountOtpTimer();

  }


  /*
   * Restore current runtime data
   * nếu user chuyển qua tab khác rồi quay lại.
   */
  if (
    current.secret
  ) {

    $('faInput').value =
      makeOtpAuth(
        current
      );


    $('faQrInput').value =
      makeOtpAuth(
        current
      );


    updateCurrentInfo();

    startCurrentOtpTimer();

  }

}


/* =========================================================
   MODULE EXPORT
========================================================= */


export const TwoFA = {

  init() {

    if (
      pasteBound
    ) {

      return;

    }


    /*
     * Dùng WINDOW + CAPTURE.
     *
     * Đây là phần để Ctrl+V
     * hoạt động kể cả cursor
     * đang nằm trong textarea.
     */
    window.addEventListener(

      'paste',

      globalPasteHandler,

      true

    );


    pasteBound =
      true;

  },


  render

};
