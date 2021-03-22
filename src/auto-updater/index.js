'use strict'

const electron = require('electron')
const fs = require('fs')
const path = require('path')
const {
  AppImageUpdater,
  MacUpdater,
  NsisUpdater,
  AppUpdater
} = require('electron-updater')
const log = require('electron-log')
const Alert = require('electron-alert')

const wins = require('../windows')

const toastStyle = fs.readFileSync(path.join(
  __dirname, 'toast-src/toast.css'
))
const toastScript = fs.readFileSync(path.join(
  __dirname, 'toast-src/toast.js'
))

let toast
let autoUpdater
let menuItem
let uCheckInterval
let isIntervalUpdate = false

const style = `<style>${toastStyle}</style>`
const script = `<script type="text/javascript">${toastScript}</script>`
const sound = { freq: 'F2', type: 'triange', duration: 1.5 }

const _closeToast = (toast) => {
  if (
    !toast ||
    !toast.browserWindow
  ) return

  toast.browserWindow.hide()
  toast.browserWindow.destroy()
}

const _fireToast = (
  opts = {},
  hooks = {}
) => {
  const {
    onOpen = () => {},
    onAfterClose = () => {}
  } = { ...hooks }

  _closeToast(toast)

  const win = (
    electron.BrowserWindow.getFocusedWindow() ||
    wins.mainWindow
  )
  const alert = new Alert([style, script])
  toast = alert

  const _closeAlert = () => _closeToast(alert)

  win.once('closed', _closeAlert)

  const bwOptions = {
    frame: false,
    transparent: true,
    thickFrame: false,
    closable: false,
    hasShadow: false
  }

  const res = alert.fire({
    toast: true,
    position: 'top-end',
    allowOutsideClick: false,
    backdrop: 'rgba(0,0,0,0.0)',
    width: 400,

    type: 'info',
    title: 'Update',
    showConfirmButton: true,
    showCancelButton: false,
    timerProgressBar: false,
    ...opts,

    onOpen: () => {
      onOpen(alert)
    },
    onClose: () => {
      if (
        !toast ||
        !toast.browserWindow
      ) return

      toast.browserWindow.hide()
    },
    onAfterClose: () => {
      win.removeListener('closed', _closeAlert)
      onAfterClose(alert)
    }
  }, bwOptions, win, true, false, sound)

  return { res, alert }
}

const _switchMenuItem = (isEnabled = false) => {
  if (
    !menuItem ||
    typeof menuItem !== 'object'
  ) {
    return
  }

  menuItem.enabled = isEnabled
}

const _reinitInterval = () => {
  clearInterval(uCheckInterval)

  uCheckInterval = setInterval(() => {
    checkForUpdatesAndNotify({ isIntervalUpdate: true })
  }, 60 * 60 * 1000).unref()
}

const _autoUpdaterFactory = () => {
  if (autoUpdater instanceof AppUpdater) {
    return autoUpdater
  }
  if (process.platform === 'win32') {
    autoUpdater = new NsisUpdater()
  }
  if (process.platform === 'darwin') {
    // TODO: don't support auto-update for mac right now
    // autoUpdater = new MacUpdater(_options)
    return autoUpdater
  }
  if (process.platform === 'linux') {
    // TODO: don't support auto-update for linux right now
    // autoUpdater = new AppImageUpdater(_options)
    return autoUpdater
  }

  autoUpdater.on('error', () => {
    _fireToast({
      title: 'Application update failed',
      type: 'error',
      timer: 60000
    })
  })
  autoUpdater.on('checking-for-update', () => {
    if (isIntervalUpdate) {
      return
    }

    _fireToast(
      {
        title: 'Checking for update',
        type: 'warning',
        timer: 10000,
        timerProgressBar: true
      },
      {
        onOpen: (alert) => alert.showLoading()
      }
    )

    _reinitInterval()
  })
  autoUpdater.on('update-available', async (info) => {
    try {
      const { version } = { ...info }

      const { res } = _fireToast(
        {
          title: `An update to v${version} is available`,
          text: 'Starting download...',
          type: 'info',
          timer: 10000,
          timerProgressBar: true
        }
      )
      const { isConfirmed, dismiss } = await res

      if (
        !isConfirmed &&
        dismiss !== 'timer'
      ) {
        return
      }

      _autoUpdaterFactory()
        .downloadUpdate()
    } catch (err) {
      console.error(err)
    }
  })
  autoUpdater.on('update-not-available', (info) => {
    if (isIntervalUpdate) {
      return
    }

    _fireToast(
      {
        title: 'No updates available',
        type: 'success',
        timer: 10000
      }
    )
  })
  // TODO:
  autoUpdater.on('download-progress', (progressObj) => {
    log.info(`Download progress: ${JSON.stringify(progressObj)}`)
  })
  autoUpdater.on('update-downloaded', async (info) => {
    try {
      const { version } = { ...info }

      const { res } = _fireToast(
        {
          title: `Update v${version} downloaded`,
          text: 'Should the app be updated right now?',
          type: 'question',
          timer: 60000,
          showCancelButton: true
        }
      )
      const { isConfirmed } = await res

      if (!isConfirmed) {
        return
      }

      _autoUpdaterFactory()
        .quitAndInstall(false, true)
    } catch (err) {
      console.error(err)
    }
  })

  autoUpdater.autoDownload = false
  autoUpdater.logger = log
  autoUpdater.logger.transports.file.level = 'info'

  _reinitInterval()

  return autoUpdater
}

const checkForUpdates = (opts) => {
  if (!menuItem) {
    menuItem = opts.menuItem
  }

  return () => {
    _switchMenuItem(false)

    return _autoUpdaterFactory()
      .checkForUpdates()
  }
}

const checkForUpdatesAndNotify = (opts) => {
  const {
    isIntervalUpdate: isIntUp = false
  } = { ...opts }

  isIntervalUpdate = isIntUp
  _switchMenuItem(false)

  return _autoUpdaterFactory()
    .checkForUpdatesAndNotify()
}

// TODO:
const quitAndInstall = () => {
  _autoUpdaterFactory()
    .quitAndInstall(false, true)
}

module.exports = {
  checkForUpdates,
  checkForUpdatesAndNotify,
  quitAndInstall
}
