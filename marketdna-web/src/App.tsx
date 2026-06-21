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
import RandomnessPage from './pages/RandomnessPage'
import OptionsPage from './pages/OptionsPage'
import ExpectedMovePage from './pages/ExpectedMovePage'
import BreakoutScannerPage from './pages/BreakoutScannerPage'
import LiveTradingPage from './pages/LiveTradingPage'
import IntradayRacePage from './pages/IntradayRacePage'
import DruckenmillerROCPage from './pages/DruckenmillerROCPage'
import SectorHeatmapPage from './pages/SectorHeatmapPage'
import CompanyIntelligencePage from './pages/CompanyIntelligencePage'

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
          <Route path="/randomness"            element={<RandomnessPage />} />
          <Route path="/options"               element={<OptionsPage />} />
          <Route path="/expected-move"         element={<ExpectedMovePage />} />
          <Route path="/breakout-scanner"      element={<BreakoutScannerPage />} />
          <Route path="/live-trading"          element={<LiveTradingPage />} />
          <Route path="/intraday-race"         element={<IntradayRacePage />} />
          <Route path="/druckenmiller-roc"     element={<DruckenmillerROCPage />} />
          <Route path="/sector-heatmap"                    element={<SectorHeatmapPage />} />
          <Route path="/company-intelligence"           element={<CompanyIntelligencePage />} />
          <Route path="/company-intelligence/:symbol"   element={<CompanyIntelligencePage />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
    </ThemeModeProvider>
  )
}
