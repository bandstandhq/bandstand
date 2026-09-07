// SPDX-License-Identifier: Apache-2.0
import { KeyedByBandId } from '../../components/KeyedByBandId';
import { SetlistDetail } from '../../pages/SetlistDetail';

export default function SetlistDetailRoute() {
  return <KeyedByBandId Component={SetlistDetail} />;
}
