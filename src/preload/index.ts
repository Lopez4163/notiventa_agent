import { contextBridge, ipcRenderer } from 'electron'
import type { AgentRendererApi, AgentState, PairDeviceInput } from '../shared/contracts'
import { IPC_CHANNELS } from '../shared/contracts'

const api: AgentRendererApi = Object.freeze({
  getState: () => ipcRenderer.invoke(IPC_CHANNELS.getState),
  pairDevice: (input: PairDeviceInput) => ipcRenderer.invoke(IPC_CHANNELS.pairDevice, input),
  subscribeToState: (listener: (state: AgentState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: AgentState): void => listener(state)
    ipcRenderer.on(IPC_CHANNELS.stateChanged, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.stateChanged, handler)
  },
  getStartWithWindows: () => ipcRenderer.invoke(IPC_CHANNELS.getStartWithWindows),
  setStartWithWindows: (enabled: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.setStartWithWindows, enabled),
  listInstalledPrinters: () => ipcRenderer.invoke(IPC_CHANNELS.listInstalledPrinters),
  getPrinterConfiguration: () => ipcRenderer.invoke(IPC_CHANNELS.getPrinterConfiguration),
  selectPrinter: (systemName: string) => ipcRenderer.invoke(IPC_CHANNELS.selectPrinter, systemName),
  clearPrinterConfiguration: () => ipcRenderer.invoke(IPC_CHANNELS.clearPrinterConfiguration)
})

contextBridge.exposeInMainWorld('notiventa', api)
