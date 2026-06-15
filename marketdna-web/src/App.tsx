import { ThemeProvider, CssBaseline } from '@mui/material'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { theme } from './theme'
import { ThemeModeProvider } from './contexts/ThemeModeContext'
import LandingPage from './pages/LandingPage'
import StockPage from './pages/StockPage'
import PatternDNAPage from './pages/PatternDNAPage'
import PatternDNAGuidePage from './pages/PatternDNAGuidePage'
import MarkovOptionsPage from './pages/MarkovOptionsPage'
import QuantStrategiesPage from './pages/QuantStrategiesPage'
import IndicatorsPage from './pages/IndicatorsPage'
import CointegrationPage from './pages/CointegrationPage'
import DeliveryPage from './pages/DeliveryPage'
import ShortPage from './pages/ShortPage'
import AgentsPage from './pages/AgentsPage'
import DataVizPage from './pages/DataVizPage'
import StockHealthPage from './pages/StockHealthPage'

export default function App() {
  return (
    <ThemeModeProvider>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <Routes>
          <Route path="/"                  element={<LandingPage />} />
          <Route path="/pattern-dna"       element={<PatternDNAPage />} />
          <Route path="/pattern-guide"     element={<PatternDNAGuidePage />} />
          <Route path="/stock"             element={<StockPage />} />
          <Route path="/stock/:symbol"     element={<StockPage />} />
          <Route path="/markov-options"    element={<MarkovOptionsPage />} />
          <Route path="/quant-strategies"  element={<QuantStrategiesPage />} />
          <Route path="/indicators"        element={<IndicatorsPage />} />
          <Route path="/cointegration"     element={<CointegrationPage />} />
          <Route path="/delivery"          element={<DeliveryPage />} />
          <Route path="/short"             element={<ShortPage />} />
          <Route path="/agents"            element={<AgentsPage />} />
          <Route path="/dataviz"           element={<DataVizPage />} />
          <Route path="/stock-health"          element={<StockHealthPage />} />
          <Route path="/stock-health/:symbol"  element={<StockHealthPage />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
    </ThemeModeProvider>
  )
}
