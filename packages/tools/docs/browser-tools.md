# Browser tools

`browserTools(applications, access)` gives a session the browser tools of each application that has a user interface (`uiUrl`) in the environment named by `access.environment`. It returns the tools and a `close()` that releases the browser; call it once the session is over.

| Tool | What it does | Browser action |
|---|---|---|
| `<id>_goto` | Opens an address of the application, absolute or relative to its user interface. | yes |
| `<id>_snapshot` | Returns the accessibility tree of the page, each element one can act on followed by its recommended locator; with `within`, an element designated as for an action, only the tree of that element, such as a table or a dialog. | no |
| `<id>_click` | Clicks an element. | yes |
| `<id>_fill` | Fills a field with a text, or with the credential of a declared test account. | yes |
| `<id>_select_option` | Chooses an option of a list, by its label or value. | yes |
| `<id>_check` | Checks or unchecks a checkbox or a radio button. | yes |
| `<id>_wait_for` | Waits until an element is visible or hidden, or until the address contains a text. | no |
| `<id>_screenshot` | Writes a PNG image of the viewport, or of the whole page, and returns its path. | no |
| `<id>_network` | Returns the latest requests of the page: the documents and the API calls, the assets when asked, and every failed request. | no |
| `<id>_console` | Returns the latest console messages and uncaught errors of the page. | no |

`<id>` is the identifier of the application, with hyphens turned into underscores: `customer-self-service` gives `customer_self_service_click`. Browser actions count against the action limit of the task; the other tools do not.

`goto`, `click`, `fill`, `select_option` and `check` return the address and the title of the page afterwards, and in `code` the line a Playwright test writes to do the same:

| Call | `code` |
|---|---|
| `shop_goto` with `http://localhost:3000/orders?status=open`, the user interface being at `http://localhost:3000` | `await page.goto("/orders?status=open");` |
| `shop_click` on `{ "role": "button", "name": "Search" }` | `await page.getByRole("button", { name: "Search", exact: true }).click();` |
| `shop_fill` on `{ "label": "Email" }` with `{ "account": "demo", "field": "username" }`, the account reading its user name from `SHOP_USER` | `await page.getByLabel("Email", { exact: true }).fill(process.env.SHOP_USER!);` |
| `shop_select_option` on `{ "role": "combobox", "name": "Kind" }` with `Car` | `await page.getByRole("combobox", { name: "Kind", exact: true }).selectOption("Car");` |
| `shop_check` on `{ "role": "checkbox" }` with `checked: false` | `await page.getByRole("checkbox").uncheck();` |
| `shop_click` on `{ "role": "button", "name": "Edit", "within": { "role": "row", "name": "Lena Veldane" } }` | `await page.getByRole("row", { name: "Lena Veldane" }).getByRole("button", { name: "Edit", exact: true }).click();` |

An address of the user interface becomes its path, query and fragment, which the base URL of the test completes; an address of an API of the application is given whole. A credential is read from the variable its account declares, never written.

## Elements and locators

Tools designate an element the way a test should: by role and accessible name, by label, by test id (`data-testid`) or by text, always matched exactly. CSS and XPath selectors are not accepted. `within` looks for the element inside a part of the page given by its role and a part of its accessible name, such as the row of a table.

In a snapshot, each element one can act on — a control, or any element the page shows as clickable — ends with `→` and the Playwright locator to use for it. The candidates follow the order the Playwright documentation recommends: role and name, then label, then test id, then text; the first that finds this very element, and no other, is given. When none does, they are tried again inside the closest row or dialog that holds the element: a row is named by the text of its first child that has one, such as its first cell, so that a button repeated on each row gets `page.getByRole("row", { name: "Lena Veldane" }).getByRole("button", { name: "Edit", exact: true })`. When none does there either, the snapshot says how many elements the first candidate matches, or that no candidate applies: the page lacks a robust locator for that element. An element inside a frame is marked as out of reach, and one the page replaced while the snapshot was taken is marked as changed. A snapshot gives a locator to 150 elements at most and is cut at a line beyond 12,000 characters; it says when it was.

## Bounds

- The browser is a headless Chromium. It starts at the first call of a browser tool and is shared by the applications; each application has its own browser context, opened on its user interface at its first call. A launch or an opening that fails is tried again at the next call.
- A page may only navigate to the origins of its application: its user interface and the APIs of the environment. Any other navigation — an address given to `goto`, a link, a script, a redirect at any hop — is cancelled before it reaches the other host, the page stays where it was, and the refusal appears among the requests. The harness follows the redirects of a navigation itself, ten at most, and then sends the browser to the last address, which is thus requested twice; a form sent with `POST` is sent once. Requests that are not navigations, such as images or API calls, are not filtered.
- An action waits five seconds for its element to be ready, and a navigation fifteen seconds; `actionTimeoutMs` and `navigationTimeoutMs` change them. A wait lasts five seconds unless the agent asks otherwise, fifteen at most.
- Once a page is opened or acted on, the tool waits until the page has sent no request for 300 ms, 3 s at most (`settleTimeoutMs`), so that what the page loads from its services is on the screen when it is read. A page that keeps a request open is read once that time is over.
- The calls a page makes to the local services of its application are allowed, as in a browser that loads the page directly.
- The network and console tools keep the last 50 entries of each kind, and return 20 unless the agent asks for more. A request still waiting for its answer shows as `pending`. Titles, addresses and console messages are cut beyond 500 characters.

## Test accounts

The agent types a credential by naming the account and the field, `{ "account": "demo", "field": "password" }`: the harness reads the value from the environment variable the account declares. The passwords of the application's accounts are replaced by `[secret]` in everything the tools return, error messages included, whether they show as typed, escaped, with their spaces collapsed or encoded in an address. User names are not masked.

## Failures

An action that fails, or a snapshot whose `within` matches no element or several, says why — no element matches, the element did not become ready in time, or several elements match — followed by a snapshot of the page as it is now, so that the agent can choose its next step without another call. A user interface that does not load, an unknown account or an unset variable fails the call and not the session.
