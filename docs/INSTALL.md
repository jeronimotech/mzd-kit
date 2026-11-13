# Installing mzd-kit apps on a Mazda Connect CMU

> ⚠️ Work in progress. This page describes how the CASDK host loads apps today. The end-to-end
> flow has not yet been validated by the mzd-kit team on real hardware. Modifying the CMU can
> brick it; you do this at your own risk.

## Prerequisites

1. **A jailbroken CMU.** Firmware up to v59.00.502 can run tweaks from USB. Later firmware
   (v59.00.504+, v70, v74) needs a one-time **serial (USB-TTL) connection** to install the
   autorun/recovery scripts; after that, USB tweaks work again.
2. **The CASDK runtime**, installed with [MZD-AIO-TI](https://github.com/Trevelopment/MZD-AIO-TI-X)
   ("Custom Applications SDK" option).
3. **Firmware note:** AIO patches the system app list for CASDK apps up to **v70.00.335**. On
   newer firmware the app-list integration must be handled differently (tracked on the roadmap).

## Build

```bash
mzd build ./my-apps --out dist
```

```
dist/
  apps.js              ← var CustomApplications = ["app.clima", "app.hola"];
  app.clima/app.js     ← single ES5 file (CSS inlined)
  app.hola/app.js
  app.hola/…           ← anything from the app's public/ folder
```

## Copy to the CMU

With SSH access to the CMU (Wi-Fi AP or tethering tweak; default user `root`):

```bash
# AIO stores CASDK apps here (or on the nav SD card if you chose that during install)
APPS=/tmp/mnt/resources/aio/mzd-casdk/apps

ssh root@<cmu-ip> "mount -o rw,remount /tmp/mnt/resources"
scp -r dist/app.hola root@<cmu-ip>:$APPS/
# add the id to the existing list (don't overwrite apps installed by AIO):
ssh root@<cmu-ip> "grep -q app.hola $APPS/apps.js || sed -i 's/^var CustomApplications = \[/&\n  \"app.hola\",/' $APPS/apps.js"
ssh root@<cmu-ip> reboot
```

Never touch the **navigation SD card** contents other than the `apps` folder AIO may have created.

`mzd deploy` will automate this (roadmap).
