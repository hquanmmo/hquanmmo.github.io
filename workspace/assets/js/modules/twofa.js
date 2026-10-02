import { esc, toast, copyText } from '../utils.js';

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
let accountTimer = null;
let qrCanvas = null;
let pasteBound = false;


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


/* =========================================================
   STATUS
========================================================= */

function showStatus(
  id,
  text,
  type = 'info'
) {

  const element =
    $(id);


  if (!element) {
    return;
  }


  const classMap = {

    success:
      'alert-success',

    danger:
      'alert-danger',

    warning:
      'alert-warning',

    info:
      'alert-info'

  };


  element.className =
    `alert ${classMap[type] || classMap.info} py-2 px-3 mb-3`;


  element.textContent =
    text;


  element.classList.remove(
    'd-none'
  );
}


function hideStatus(id) {

  const element =
    $(id);


  if (!element) {
    return;
  }


  element.className =
    'd-none';


  element.textContent =
    '';
}


/* =========================================================
   OTP AUTH
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


  /*
   * Secret Base32 thông thường
   */
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
        ''
    };


    return current;
  }


  /*
   * otpauth://
   */
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
    )
      .toLowerCase();


  if (
    type !== 'totp'
  ) {

    throw new Error(
      'Chỉ hỗ trợ TOTP.'
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


  const colonIndex =
    label.indexOf(':');


  if (
    colonIndex >= 0
  ) {

    if (!issuer) {

      issuer =
        label
          .slice(
            0,
            colonIndex
          )
          .trim();
    }


    account =
      label
        .slice(
          colonIndex + 1
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
    account.issuer ||
    '2FA';


  const accountName =
    account.account ||
    '2FA';


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

function base32ToBytes(secret) {

  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';


  let bits =
    '';


  const bytes =
    [];


  for (
    const character
    of normalizeBase32(secret)
  ) {

    const index =
      alphabet.indexOf(
        character
      );


    if (
      index < 0
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


  const secretBytes =
    base32ToBytes(
      account.secret
    );


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


  let counterValue =
    counter;


  for (

    let i = 7;

    i >= 0;

    i--

  ) {

    counterBytes[i] =
      counterValue & 255;


    counterValue =
      Math.floor(
        counterValue /
        256
      );
  }


  const algorithm =
    String(
      account.algorithm ||
      'SHA1'
    )
      .toUpperCase();


  const hashName =

    algorithm === 'SHA512'

      ? 'SHA-512'

      : algorithm === 'SHA256'

        ? 'SHA-256'

        : 'SHA-1';


  const key =
    await crypto.subtle.importKey(

      'raw',

      secretBytes,

      {

        name:
          'HMAC',

        hash:
          hashName

      },

      false,

      [
        'sign'
      ]
    );


  const signed =
    new Uint8Array(

      await crypto.subtle.sign(

        'HMAC',

        key,

        counterBytes

      )

    );


  const offset =
    signed[
      signed.length - 1
    ] & 15;


  const binary = (

    (
      (
        signed[offset] &
        127
      ) << 24
    ) |

    (
      (
        signed[
          offset + 1
        ] &
        255
      ) << 16
    ) |

    (
      (
        signed[
          offset + 2
        ] &
        255
      ) << 8
    ) |

    (
      signed[
        offset + 3
      ] &
      255
    )

  ) >>> 0;


  const digits =
    Number(
      account.digits
    ) || 6;


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


/* =========================================================
   OTP UI
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

    `${current.algorithm} · ${current.digits} digits · ${current.period}s`;
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

      await generateTOTP(
        current
      );


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


  otpTimer =
    setInterval(

      updateMainOTP,

      1000

    );
}


/* =========================================================
   QR IMAGE READER
   Giữ pipeline giống code gốc
========================================================= */

function readQR(file) {

  if (!file) {
    return;
  }


  if (
    typeof jsQR ===
    'undefined'
  ) {

    showStatus(
      'faStatus',
      'jsQR chưa được tải.',
      'danger'
    );

    return;
  }


  const reader =
    new FileReader();


  reader.onerror =
    () => {

      showStatus(

        'faStatus',

        'Không đọc được ảnh.',

        'danger'

      );
    };


  reader.onload =
    event => {

      const image =
        new Image();


      image.onerror =
        () => {

          showStatus(

            'faStatus',

            'Ảnh không hợp lệ.',

            'danger'

          );
        };


      image.onload =
        () => {

          const canvas =
            document.createElement(
              'canvas'
            );


          const max =
            3200;


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


          const imageData =
            context.getImageData(

              0,
              0,

              width,
              height

            );


          const qr =
            jsQR(

              imageData.data,

              width,

              height,

              {
                inversionAttempts:
                  'attemptBoth'
              }

            );


          if (!qr) {

            showStatus(

              'faStatus',

              'Không tìm thấy QR trong ảnh.',

              'danger'

            );


            showStatus(

              'faMigrationStatus',

              'Không tìm thấy QR trong ảnh.',

              'danger'

            );


            return;
          }


          try {

            handleQRText(
              qr.data
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
        };


      image.src =
        event.target.result;
    };


  reader.readAsDataURL(
    file
  );
}


/* =========================================================
   HANDLE QR TEXT
========================================================= */

function handleQRText(text) {

  text =
    String(text || '')
      .trim();


  if (
    $('faMigrationText')
  ) {

    $('faMigrationText')
      .value =
      text;
  }


  /*
   * GOOGLE AUTHENTICATOR MIGRATION
   */
  if (
    text.startsWith(
      'otpauth-migration://'
    )
  ) {

    const count =
      decodeMigration(
        text
      );


    const migrationTab =
      document.querySelector(

        '[data-bs-target="#faMigration"]'

      );


    if (
      migrationTab
    ) {

      bootstrap.Tab
        .getOrCreateInstance(
          migrationTab
        )
        .show();
    }


    showStatus(

      'faMigrationStatus',

      `✓ Đã giải mã ${count} tài khoản.`,

      'success'

    );


    return;
  }


  /*
   * NORMAL OTPAUTH
   */
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

      $('faInput').value =
        text;
    }


    if (
      $('faQrInput')
    ) {

      $('faQrInput').value =
        text;
    }


    updateInfo();

    startOTP();


    showStatus(

      'faStatus',

      '✓ Đã đọc QR otpauth.',

      'success'

    );


    const authTab =
      document.querySelector(

        '[data-bs-target="#faAuth"]'

      );


    if (
      authTab
    ) {

      bootstrap.Tab
        .getOrCreateInstance(
          authTab
        )
        .show();
    }


    return;
  }


  /*
   * QR chứa Secret Base32 thuần
   */
  const secret =
    normalizeBase32(
      text
    );


  if (
    isBase32(secret)
  ) {

    parseOTPAuth(
      secret
    );


    $('faInput').value =
      secret;


    $('faQrInput').value =
      secret;


    updateInfo();

    startOTP();


    showStatus(

      'faStatus',

      '✓ Đã đọc Secret từ QR.',

      'success'

    );


    return;
  }


  throw new Error(
    'QR không phải otpauth:// hoặc Google Authenticator Migration.'
  );
}


/* =========================================================
   GOOGLE AUTHENTICATOR MIGRATION

   Đây là decoder từ code gốc đã chạy được.
========================================================= */

function parseMigrationQR(uri) {

  if (
    !uri.startsWith(
      'otpauth-migration://offline?data='
    )
  ) {

    throw new Error(
      'Không phải Google Authenticator Migration QR.'
    );
  }


  const encoded =
    uri.split(
      'data='
    )[1];


  if (!encoded) {

    throw new Error(
      'Migration QR không có data.'
    );
  }


  let decoded;


  try {

    decoded =
      decodeURIComponent(
        encoded
      );

  } catch {

    throw new Error(
      'Không decode được Migration URI.'
    );
  }


  let binary;


  try {

    binary =
      atob(
        decoded
      );

  } catch {

    throw new Error(
      'Không decode được Base64 Migration.'
    );
  }


  const bytes =
    Uint8Array.from(

      binary,

      character =>
        character.charCodeAt(0)

    );


  return parseMigrationBytes(
    bytes
  );
}


/* =========================================================
   MIGRATION PROTOBUF
========================================================= */

function parseMigrationBytes(
  bytes
) {

  let offset = 0;

  const output =
    [];


  const varint =
    () => {

      let result = 0;

      let shift = 0;


      while (
        offset <
        bytes.length
      ) {

        const byte =
          bytes[
            offset++
          ];


        result |=

          (
            byte &
            127
          ) << shift;


        if (
          !(byte & 128)
        ) {

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


    /*
     * field 1 =
     * repeated OtpParameters
     */
    if (
      field === 1
    ) {

      const length =
        varint();


      const sub =
        bytes.subarray(

          offset,

          offset +
          length

        );


      offset +=
        length;


      const account =
        parseOtpParameters(
          sub
        );


      if (
        account
      ) {

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

      const length =
        varint();


      offset +=
        length;

    } else {

      break;
    }
  }


  return output;
}


/* =========================================================
   OTP PARAMETERS
========================================================= */

function parseOtpParameters(
  bytes
) {

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


  const varint =
    () => {

      let result = 0;

      let shift = 0;


      while (
        offset <
        bytes.length
      ) {

        const byte =
          bytes[
            offset++
          ];


        result |=

          (
            byte &
            127
          ) << shift;


        if (
          !(byte & 128)
        ) {

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

      const length =
        varint();


      const value =
        new TextDecoder()
          .decode(

            bytes.subarray(

              offset,

              offset +
              length

            )

          );


      offset +=
        length;


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


    if (
      field === 1
    ) {

      const length =
        varint();


      secretBytes =
        bytes.subarray(

          offset,

          offset +
          length

        );


      offset +=
        length;

    } else if (
      field === 2
    ) {

      name =
        text();

    } else if (
      field === 3
    ) {

      issuer =
        text();

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
      wire === 0
    ) {

      varint();

    } else if (
      wire === 2
    ) {

      const length =
        varint();


      offset +=
        length;

    } else {

      break;
    }
  }


  if (
    !secretBytes
  ) {

    return null;
  }


  const algorithmMap = {

    1:
      'SHA1',

    2:
      'SHA256',

    3:
      'SHA512',

    4:
      'MD5'

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

      digits === 2
        ? 8
        : 6,

    period:
      30
  };
}


/* =========================================================
   DECODE MIGRATION
========================================================= */

function decodeMigration(uri) {

  const result =
    parseMigrationQR(

      String(
        uri ||
        ''
      )
        .trim()

    );


  if (
    !result.length
  ) {

    throw new Error(
      'Không tìm thấy tài khoản trong QR.'
    );
  }


  accounts = [

    ...accounts,

    ...result

  ];


  renderAccounts();

  startAccountTimer();


  return result.length;
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

          Chưa có dữ liệu.

        </td>

      </tr>

    `;


    if (
      $('faAccountCount')
    ) {

      $('faAccountCount')
        .textContent =
        '0';
    }


    return;
  }


  if (
    $('faAccountCount')
  ) {

    $('faAccountCount')
      .textContent =
      String(
        accounts.length
      );
  }


  const rows =
    await Promise.all(

      accounts.map(

        async (
          account,
          index
        ) => {

          let otp =
            '------';


          try {

            otp =
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
                  account.name ||
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

                <code
                  class="small"
                >
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
                class="fw-bold code-font text-success"
                data-fa-otp="${index}"
              >
                ${esc(otp)}
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


/* =========================================================
   MIGRATION OTP TIMER
========================================================= */

async function updateAccountOTPs() {

  await Promise.all(

    accounts.map(

      async (
        account,
        index
      ) => {

        const element =
          document.querySelector(

            `[data-fa-otp="${index}"]`

          );


        if (!element) {

          return;
        }


        try {

          element.textContent =
            await generateTOTP(
              account
            );

        } catch {

          element.textContent =
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

  value =
    String(value || '')
      .trim();


  if (!value) {

    throw new Error(
      'Hãy nhập Secret hoặc otpauth://.'
    );
  }


  /*
   * Existing otpauth URI
   */
  if (
    value
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
        value
      );

    } finally {

      current =
        backup;
    }


    return value;
  }


  /*
   * Base32
   */
  const secret =
    normalizeBase32(
      value
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
      '2FA'
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
   CTRL + V
   Giữ cách bắt clipboard giống code gốc
========================================================= */

function pasteHandler(event) {

  const module =
    host();


  if (
    !module ||
    !module
      .classList
      .contains('active') ||
    !event.clipboardData
  ) {

    return;
  }


  for (
    const item
    of event
      .clipboardData
      .items ||
    []
  ) {

    if (
      String(
        item.type ||
        ''
      )
        .startsWith(
          'image/'
        )
    ) {

      const file =
        item.getAsFile();


      if (file) {

        readQR(
          file
        );


        event.preventDefault();
      }


      return;
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
   * Capture phase để vẫn bắt ảnh
   * khi cursor đang ở textarea.
   */
  document.addEventListener(

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

        <h4 class="mb-1">

          <i
            class="bi bi-shield-lock-fill text-primary me-2"
          ></i>

          2FA Authenticator

        </h4>

        <div
          class="small text-secondary"
        >

          Secret, QR và OTP chỉ xử lý trong trình duyệt.
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

          Migration QR

        </button>

      </li>

    </ul>


    <div
      class="tab-content"
    >


      <!-- ================================================
           AUTHENTICATOR
      ================================================= -->

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

                Hỗ trợ QR đơn và Google Authenticator Migration

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
          id="faMigrationStatus"
          class="d-none"
        ></div>


        <div
          class="card p-3"
        >

          <div
            class="row g-4"
          >


            <div
              class="col-lg-4"
            >

              <div
                class="d-flex align-items-center gap-2 mb-2"
              >

                <i
                  class="bi bi-qr-code-scan fs-4 text-primary"
                ></i>


                <div>

                  <div
                    class="fw-semibold"
                  >

                    Google Authenticator Migration

                  </div>

                  <div
                    class="small text-secondary"
                  >

                    Export một hoặc nhiều tài khoản

                  </div>

                </div>

              </div>


              <div
                id="faMigrationDrop"
                class="qr-drop mb-3"
                tabindex="0"
              >

                <i
                  class="bi bi-images fs-1 d-block mb-2"
                ></i>


                <div
                  class="fw-semibold"
                >

                  Ctrl+V / kéo / chọn QR Migration

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
                rows="7"
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

                  Giải mã

                </button>


                <button
                  id="faCopyAll"
                  class="btn btn-outline-secondary btn-sm"
                >

                  <i
                    class="bi bi-copy me-1"
                  ></i>

                  Copy tất cả Secret

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

            </div>


            <div
              class="col-lg-8"
            >

              <div
                class="d-flex justify-content-between align-items-center mb-2"
              >

                <strong>
                  Kết quả
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
          ''
      };


      clearInterval(
        otpTimer
      );


      render();
    };


  /* ======================================================
     FILE
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

        eventName => {

          element.addEventListener(

            eventName,

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

        eventName => {

          element.addEventListener(

            eventName,

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

          readQR(

            event
              .dataTransfer
              .files?.[0]

          );
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

        const count =
          decodeMigration(

            $('faMigrationText')
              .value
              .trim()

          );


        showStatus(

          'faMigrationStatus',

          `✓ Đã giải mã ${count} tài khoản.`,

          'success'

        );

      } catch (error) {

        showStatus(

          'faMigrationStatus',

          'Lỗi giải mã: ' +
          error.message,

          'danger'

        );
      }
    };


  $('faCopyAll').onclick =
    async () => {

      if (
        !accounts.length
      ) {

        toast(
          'Chưa có tài khoản.',
          'warning'
        );

        return;
      }


      await copyText(

        accounts
          .map(

            account =>

              `${
                account.issuer ||
                'Account'
              }: ${
                account.account ||
                account.name
              } - ${
                account.secret
              }`

          )
          .join('\n')

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


      clearInterval(
        accountTimer
      );


      renderAccounts();


      hideStatus(
        'faMigrationStatus'
      );
    };


  /* ======================================================
     RESTORE RUNTIME
  ====================================================== */

  renderAccounts();


  if (
    accounts.length
  ) {

    startAccountTimer();
  }


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