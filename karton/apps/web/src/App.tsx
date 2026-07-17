import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth.tsx';
import { Login } from './pages/Login.tsx';
import { Layout } from './components/Layout.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { Customers } from './pages/Customers.tsx';
import { CustomerProfile } from './pages/CustomerProfile.tsx';
import { Vehicles } from './pages/Vehicles.tsx';
import { VehicleDetail } from './pages/VehicleDetail.tsx';
import { Pricelist } from './pages/Pricelist.tsx';
import { WorkOrders } from './pages/WorkOrders.tsx';
import { Nezavrseni } from './pages/Nezavrseni.tsx';
import { WorkOrderDetail } from './pages/WorkOrderDetail.tsx';
import { Documents } from './pages/Documents.tsx';
import { DocumentView } from './pages/DocumentView.tsx';
import { Calendar } from './pages/Calendar.tsx';
import { WorkOrderPrint } from './pages/WorkOrderPrint.tsx';
import { Reports } from './pages/Reports.tsx';
import { Settings } from './pages/Settings.tsx';

function Protected({ children }: { children: React.JSX.Element }): React.JSX.Element {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="fullscreen-msg">Učitavanje…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

function AppRoutes(): React.JSX.Element {
  const { user, loading } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user && !loading ? <Navigate to="/" replace /> : <Login />} />
      {/* Radni nalog za štampu — namerno IZVAN Layout-a (bez sidebar-a), otvara dijalog štampe */}
      <Route path="/nalozi/:id/stampa" element={<Protected><WorkOrderPrint /></Protected>} />
      <Route
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/klijenti" element={<Customers />} />
        <Route path="/klijenti/:id" element={<CustomerProfile />} />
        <Route path="/vozila" element={<Vehicles />} />
        <Route path="/vozila/:id" element={<VehicleDetail />} />
        <Route path="/nezavrseni" element={<Nezavrseni />} />
        <Route path="/nalozi" element={<WorkOrders />} />
        <Route path="/nalozi/:id" element={<WorkOrderDetail />} />
        <Route path="/kalendar" element={<Calendar />} />
        <Route path="/dokumenti" element={<Documents />} />
        <Route path="/dokumenti/:id" element={<DocumentView />} />
        <Route path="/cenovnik" element={<Pricelist />} />
        <Route path="/izvestaji" element={<Reports />} />
        <Route path="/podesavanja" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App(): React.JSX.Element {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
