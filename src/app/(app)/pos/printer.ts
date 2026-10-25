"use client";
/**
 * Thermal printers over WebUSB or Web Serial (Chrome/Edge on desktop and Android). The browser remembers the device
 * the user picked, so after the first "Connect printer" we reconnect silently. Falls back to the browser print dialog.
 */

/* Minimal typings: these APIs are not in TypeScript's DOM lib. */
type UsbEndpoint = { endpointNumber: number; direction: "in" | "out"; type: string };
type UsbDevice = {
  productName?: string; opened: boolean; configuration: { interfaces: { interfaceNumber: number; alternate: { endpoints: UsbEndpoint[] } }[] } | null;
  open(): Promise<void>; selectConfiguration(n: number): Promise<void>; claimInterface(n: number): Promise<void>; transferOut(ep: number, data: Uint8Array): Promise<unknown>;
};
type SerialPortLike = { open(o: { baudRate: number }): Promise<void>; readable: unknown; writable: WritableStream<Uint8Array> | null; getInfo(): { usbProductId?: number } };
type Nav = Navigator & {
  usb?: { requestDevice(o: { filters: object[] }): Promise<UsbDevice>; getDevices(): Promise<UsbDevice[]> };
  serial?: { requestPort(): Promise<SerialPortLike>; getPorts(): Promise<SerialPortLike[]> };
};

export type PrinterKind = "usb" | "serial" | "browser";
const KEY = "ps-printer";
let usb: { device: UsbDevice; endpoint: number } | null = null;
let serial: SerialPortLike | null = null;

export const printerSupport = () => {
  const n = (typeof navigator === "undefined" ? {} : navigator) as Nav;
  return { usb: !!n.usb, serial: !!n.serial };
};

export function savedPrinter(): { kind: PrinterKind; width: number } {
  try { return { kind: "browser", width: 42, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { return { kind: "browser", width: 42 }; }
}
export const savePrinter = (p: { kind: PrinterKind; width: number }) => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {} };

async function openUsb(device: UsbDevice) {
  if (!device.opened) await device.open();
  if (!device.configuration) await device.selectConfiguration(1);
  for (const i of device.configuration!.interfaces) {
    const ep = i.alternate.endpoints.find((e) => e.direction === "out" && e.type === "bulk");
    if (ep) {
      await device.claimInterface(i.interfaceNumber).catch(() => {});
      usb = { device, endpoint: ep.endpointNumber };
      return device.productName || "USB printer";
    }
  }
  throw new Error("This USB device is not a printer");
}

async function openSerial(port: SerialPortLike) {
  if (!port.writable) await port.open({ baudRate: 9600 });
  serial = port;
  return "Serial / Bluetooth printer";
}

/** Asks the user to pick a printer (must run from a click). Returns its name. */
export async function connectPrinter(kind: "usb" | "serial"): Promise<string> {
  const n = navigator as Nav;
  if (kind === "usb") {
    if (!n.usb) throw new Error("USB printing needs Chrome or Edge");
    return openUsb(await n.usb.requestDevice({ filters: [] }));
  }
  if (!n.serial) throw new Error("Serial printing needs Chrome or Edge");
  return openSerial(await n.serial.requestPort());
}

/** Reconnects to the printer picked before, without a prompt. */
export async function reconnectPrinter(kind: PrinterKind): Promise<string | null> {
  const n = navigator as Nav;
  try {
    if (kind === "usb" && n.usb) { const [d] = await n.usb.getDevices(); return d ? await openUsb(d) : null; }
    if (kind === "serial" && n.serial) { const [p] = await n.serial.getPorts(); return p ? await openSerial(p) : null; }
  } catch { /* unplugged: fall back to browser print */ }
  return null;
}

/** Sends raw ESC/POS bytes. False when no printer is connected (caller falls back to window.print()). */
export async function printBytes(bytes: Uint8Array): Promise<boolean> {
  if (usb) {
    for (let i = 0; i < bytes.length; i += 8192) await usb.device.transferOut(usb.endpoint, bytes.slice(i, i + 8192));
    return true;
  }
  if (serial?.writable) {
    const w = serial.writable.getWriter();
    try { await w.write(bytes); } finally { w.releaseLock(); }
    return true;
  }
  return false;
}
