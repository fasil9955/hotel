# Hotel

Billing and order system for a hotel restaurant. Tablets take orders. One thermal printer sends tickets to the kitchen, and one prints the bill at the cashier.

## Hardware in use

- Two Retsol thermal printers
  - Kitchen printer on the LAN
  - Cashier printer at the counter
- Two tablets for taking orders
- Wi-Fi between the tablets and the billing PC
- Billing PC: Windows 10, Intel Celeron J4125, 4 GB RAM

The software needs to stay light enough to run on that PC.

## Stack

The billing PC is the server. Tablets and the cashier screen are browsers on the hotel Wi-Fi.

- Node.js 24 LTS and TypeScript
- Fastify for the API and for serving the screens
- SQLite through Node's built-in `node:sqlite` (one database file)
- React and Vite for the order, cashier, and setup screens
- ESC/POS over TCP port 9100 for the Retsol printers

Docker, a separate database, and a desktop app shell are intentionally out. The PC has 4 GB of RAM, and billing has to keep working when the internet is down.

## Build order

1. Foundation: the app opens on a tablet, and both printers print a test slip.
2. Menu and tables.
3. Orders and kitchen tickets. A later addition prints only the new items.
4. Bills, with GST shown as CGST and SGST, and payment recorded as cash, UPI, or card.
5. Day totals, a database backup, start with Windows, and a staff PIN.

## Laptop now, hotel PC later

Build and try the screens on this laptop. The hotel PC is the machine that stays on for service: Windows 10, the two printers, and the tablets on the hotel Wi-Fi.

Printer addresses and the database are filled in on the hotel PC. `data/` is not in git, so work on the laptop does not overwrite the hotel's bills or settings.

Node.js 24, 64-bit, runs on that PC (Windows 10 LTSC 1809). Use the 64-bit installer. Node 24 does not publish a 32-bit Windows build.

## Run on this laptop

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:5173. Leave the printer addresses empty until the app is on the hotel network. Save stores the hotel name and GST in `data/hotel.sqlite` on this laptop only.

```bash
npm test
npm run build
npm start
```

`npm start` serves the built app on port 3780.

## Move this copy to the hotel PC

The hotel Wi-Fi will have different addresses from this laptop. Nothing in the software is tied to the current Wi-Fi. On the hotel PC, Setup shows the new tablet address after that PC joins the hotel Wi-Fi.

The code is at https://github.com/fasil9955/hotel. The menu, employees, bills, expenses, and tablet PIN live in `data\hotel.sqlite`. That file is not in GitHub. Copy `D:\hotel\data` from this laptop onto the hotel PC after the clone, into `D:\hotel\data`. Skip `node_modules`. The hotel PC installs its own.

On the hotel PC:

1. Install the 64-bit Node.js 24 LTS installer from https://nodejs.org. The hotel PC is 64-bit Windows 10. Do not install a 32-bit Node. Install Git if it is not already there.
2. In Command Prompt, run `git clone https://github.com/fasil9955/hotel.git D:\hotel`. Sign in to GitHub when Git asks. This repository is private.
3. Copy `data` from the laptop into `D:\hotel\data`.
4. Connect that PC, both tablets, and both printers to the same hotel Wi-Fi. A guest network that hides devices from each other will not work.
5. Open `D:\hotel` in Command Prompt and run `npm install`, then `npm run build`.
6. Right-click `allow-tablets.bat` and choose Run as administrator. This opens port 3780 for the tablets and leaves the firewall on.
7. Double-click `start-hotel.bat`. Leave that window open during service.
8. On the hotel PC only, open Chrome at http://localhost:3780. Opening the Wi-Fi address on this PC makes it an order tablet.
9. In Setup, enter the kitchen and cashier printer addresses. Retsol printers use port 9100. Print a test slip from each. Set Bill copies, then Save.
10. On Setup, press Start with Windows if this PC should open the billing window at sign-in.
11. On each tablet, open the address shown under Tablets on the Setup page, for example `http://192.168.1.20:3780`. The numbers change with the hotel Wi-Fi. Read them from Setup. Do not reuse this laptop's address.

The hotel PC screen has orders, the cashier, the menu, the day, expenses, attendance, and admin. Tablets only take orders. The admin PIN stays 313786. The tablet PIN already saved in `data\hotel.sqlite` is the one the tablets will ask for.

## Status

Orders, the cashier bill, the menu, today's totals, expenses, attendance, admin, and a database backup are in this copy. Printer addresses stay empty until they are entered on the hotel Wi-Fi.
