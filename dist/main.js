var stream=null,
      audio=null,
      mixedStream=null,
      chunk=[],
      recorder=null,
      startButton=null,
      stopButton=null,
      downloadButton=null,
      recordedVideo=null;

const setupStream = async () => {
  try {
      stream = await navigator.mediaDevices.getDisplayMedia({
          video: true
      });
      audio = await navigator.mediaDevices.getUserMedia({
          audio: {
              echoCancellation: true,
              noiseSuppression: true,
              sampleRate: 44100
          }
      });
      setupVideoFeedback();
  } catch (err){
      console.error(err);
  }
}

setupVideoFeedback = () =>{
    if (stream) {
        const video = document.querySelector('.video-feedback');
        video.srcObject = stream;
        video.play();
    }else{
        console.warn("no stream variable")
    }
}

const startRecording = async () =>{
    await setupStream();
    if (stream && audio) {
        mixedStream = new MediaStream([...stream.getTracks(), ...audio.getTracks()]);
        recorder = new MediaRecorder(mixedStream);
        recorder.ondataavailable = handleDataAvailable;
        recorder.onstop = handleStop;
        recorder.start(200);

        startButton.disabled = true;
        stopButton.disabled=false;

        console.log('recording started');
    }else{
        console.warn("No stream available");
    }
}

handleDataAvailable = (e) =>{
    chunk.push(e.data);
}

handleStop = () =>{
    const blob = new Blob(chunk, {
        type: "video/mp4"
    })
    chunk = [];

    downloadButton.href = URL.createObjectURL(blob);
    downloadButton.download = 'video.mp4';
    downloadButton.disabled = false;

    recordedVideo.src = URL.createObjectURL(blob);
    recordedVideo.load();
    recordedVideo.onloadeddata = ()=>{
        recordedVideo.play();

        const rc = document.querySelector(".recorded-video-wrap");
        rc.classList.remove("hidden");
        rc.scrollIntoView({ behavior:"smooth", block:"start"});
    }
    stream.getTracks().foreach(track => track.stop());
    audio.getTracks().foreach(track => track.stop());

    console.log('readed ready');
}

stopRecording = () =>{
    recorder.stop();
    startButton.disabled = false;
    stopButton.disabled = true;

    console.log("Video stopped");
};

window.addEventListener('load', () => {
    startButton = document.querySelector('.start-recording');
    stopButton = document.querySelector('.stop-recording');
    downloadButton = document.querySelector('.download-record');
    recordedVideo = document.querySelector('.recorded-video');
    
    startButton.addEventListener('click', startRecording);
    stopButton.addEventListener('click', stopRecording);

    // downloadButton.addEventListener('click', downloadvideo);
});


