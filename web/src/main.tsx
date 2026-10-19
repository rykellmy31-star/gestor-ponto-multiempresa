
import React from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter, Routes, Route, Navigate, Link} from 'react-router-dom';
import '@fontsource-variable/inter';
import './styles.css';

import {LoginPage, ForgotPage, ResetPage, SetupPage} from './auth-pages';
import {ProtectedLayout, HelpPage} from './layout';
import {ToastProvider, Button, Empty} from './ui';
import {ClockPage, EmployeeReportPage, EmployeeRequestsPage, AccountPage} from './employee-pages';
import {AdminDashboard, EmployeesPage} from './admin-team';
import {RecordsPage, AdminReportsPage, AdminOccurrencesPage} from './admin-records';
import {SchedulesPage, SettingsPage, AdminUsersPage, AuditPage} from './admin-settings';
import {AdminMoodPage} from './admin-mood';
import {PlatformPage} from './platform-pages';
import {PlatformDemoPage} from './platform-demo';
import {EmployeeCpfPage} from './employee-cpf-pages';
import {DeveloperCredit} from './developer-credit';
import {SalesPage} from './sales-page';

class ErrorBoundary extends React.Component<
  {children: React.ReactNode},
  {failed: boolean}
> {
  state = {failed: false};

  static getDerivedStateFromError() {
    return {failed: true};
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="full-loading">
          <Empty
            title="Não foi possível exibir esta página"
            text="Seus registros permanecem no banco. Atualize a página para tentar novamente."
            action={<Button onClick={() => window.location.reload()}>Atualizar página</Button>}
          />
        </div>
      );
    }

    return this.props.children;
  }
}

function NotFound() {
  return (
    <div className="full-loading">
      <Empty
        title="Página não encontrada"
        text="Confira o endereço ou retorne ao acesso do sistema."
        action={<Link to="/funcionario" className="btn btn-primary">Ir para o CR JORNADA</Link>}
      />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <BrowserRouter>
      <ToastProvider>
        <div className="cr-site-frame">
          <div className="cr-site-content">
        <Routes>
          <Route path="/" element={<Navigate to="/funcionario" replace/>}/>
          <Route path="/entrar" element={<Navigate to="/funcionario" replace/>}/>
          <Route path="/admin/entrar" element={<LoginPage realm="admin"/>}/>
          <Route path="/setup" element={<SetupPage/>}/>
          <Route path="/recuperar-senha" element={<ForgotPage/>}/>
          <Route path="/redefinir-senha" element={<ResetPage/>}/>

          <Route path="/superadmin" element={<PlatformPage/>}/>
          <Route path="/demo-superadmin" element={<PlatformDemoPage/>}/>
          <Route path="/vendas" element={<SalesPage/>}/>
          <Route path="/planos" element={<Navigate to="/vendas" replace/>}/>
          <Route path="/superadmin/vendas" element={<PlatformPage/>}/>
          <Route path="/funcionario" element={<EmployeeCpfPage/>}/>

          <Route path="/app" element={<ProtectedLayout realm="employee"/>}>
            <Route index element={<ClockPage/>}/>
            <Route path="folha" element={<EmployeeReportPage/>}/>
            <Route path="solicitacoes" element={<EmployeeRequestsPage/>}/>
            <Route path="conta" element={<AccountPage/>}/>
            <Route path="ajuda" element={<HelpPage/>}/>
          </Route>

          <Route path="/admin" element={<ProtectedLayout realm="admin"/>}>
            <Route index element={<AdminDashboard/>}/>
            <Route path="funcionarios" element={<EmployeesPage/>}/>
            <Route path="registros" element={<RecordsPage/>}/>
            <Route path="relatorios" element={<AdminReportsPage/>}/>
            <Route path="ocorrencias" element={<AdminOccurrencesPage/>}/>
            <Route path="humor" element={<AdminMoodPage/>}/>
            <Route path="jornadas" element={<SchedulesPage/>}/>
            <Route path="configuracoes" element={<SettingsPage/>}/>
            <Route path="administradores" element={<AdminUsersPage/>}/>
            <Route path="auditoria" element={<AuditPage/>}/>
            <Route path="conta" element={<AccountPage/>}/>
            <Route path="ajuda" element={<HelpPage/>}/>
          </Route>

          <Route path="*" element={<NotFound/>}/>
        </Routes>
          </div>
          <DeveloperCredit/>
        </div>
      </ToastProvider>
    </BrowserRouter>
  </ErrorBoundary>
);
