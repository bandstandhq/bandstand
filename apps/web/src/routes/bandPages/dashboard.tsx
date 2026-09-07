// SPDX-License-Identifier: Apache-2.0
import { KeyedByBandId } from '../../components/KeyedByBandId';
import { Dashboard } from '../../pages/Dashboard';

export default function DashboardRoute() {
  return <KeyedByBandId Component={Dashboard} />;
}
