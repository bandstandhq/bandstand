// SPDX-License-Identifier: Apache-2.0
import { KeyedByBandId } from '../../components/KeyedByBandId';
import { SetlistList } from '../../pages/SetlistList';

export default function SetlistListRoute() {
  return <KeyedByBandId Component={SetlistList} />;
}
