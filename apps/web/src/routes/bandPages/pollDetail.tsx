// SPDX-License-Identifier: Apache-2.0
import { KeyedByBandId } from '../../components/KeyedByBandId';
import { PollDetail } from '../../pages/PollDetail';

export default function PollDetailRoute() {
  return <KeyedByBandId Component={PollDetail} />;
}
