import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App'
import './styles.css'
import './future-theme.css'
import './project-future.css'
import './machine-future.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#285de5',
          colorInfo: '#087f91',
          colorSuccess: '#147967',
          colorWarning: '#ac660d',
          colorError: '#c6424d',
          colorText: '#17212e',
          colorTextSecondary: '#637083',
          colorBorder: '#dce2ea',
          colorBgBase: '#ffffff',
          colorBgContainer: '#ffffff',
          borderRadius: 6,
          controlHeight: 38,
          fontSize: 14,
          fontFamily: 'Segoe UI, Microsoft YaHei UI, Microsoft YaHei, sans-serif',
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ConfigProvider>
  </StrictMode>,
)
