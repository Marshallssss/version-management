import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App'
import './styles.css'

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
          colorPrimary: '#e66d3f',
          colorInfo: '#3b93a5',
          colorSuccess: '#58a47b',
          colorWarning: '#d39a3b',
          colorError: '#d9514e',
          colorText: '#dce5e5',
          colorTextSecondary: '#93a4a5',
          colorBgBase: '#101a1d',
          colorBgContainer: '#172326',
          borderRadius: 4,
          fontFamily: 'Aptos, Microsoft YaHei UI, Microsoft YaHei, sans-serif',
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ConfigProvider>
  </StrictMode>,
)
