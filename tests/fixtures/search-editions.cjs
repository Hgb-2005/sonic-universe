'use strict';

const track=(mediaId,name,artist,album)=>({mediaId,name,artist,album,provider:'qishui',duration:32});

module.exports=[
  {
    query:'Live Forever Oasis Live',
    unqualified:'Live Forever Oasis',
    tracks:[
      track('79301','Forever (Live)','Oasis','Live at the Fixture Hall'),
      track('79302','Live Forever','Oasis','Recording Collection'),
      track('79303','Live Forever (Live)','Oasis','Live at the Fixture Theater'),
    ],
  },
  {
    query:'Let Me Love You DJ Snake Live',
    unqualified:'Let Me Love You DJ Snake',
    tracks:[
      track('79304','Let Me Love You (Live)','另一位测试歌手','Live at the Fixture Hall'),
      track('79305','Let Me Love You','DJ Snake','Recording Collection'),
      track('79306','Let Me Love You (Live)','DJ Snake','Live at the Fixture Theater'),
    ],
  },
];
