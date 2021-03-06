// triangulator2-app
// Copyright 2019 jackw01. Released under the MIT License (see LICENSE for details).

import _ from 'lodash';
import React, { Component } from 'react';
import { Container, Row, Col, Form, FormGroup, Label, Input, ButtonGroup, Button } from 'reactstrap';
import { ChromePicker } from 'react-color';
import chroma from 'chroma-js';
import canvg from 'canvg';
import saveAs from 'file-saver';
import Triangulator from 'triangulator2';

class App extends Component {
  constructor(props) {
    super(props);
    this.state = {
      svgNeedsUpdating: true,
      svgSizeCSS: { width: '', height: '' },
      svgWidth: 3840,
      svgHeight: 2400,
      svgString: '',
      imageData: [],
      imageWidth: 0,
      imageHeight: 0,
      options: {
        isBrowser: true,
        seed: 4,
        width: 3840,
        height: 2400,
        gridMode: Triangulator.GridMode.Poisson,
        gridOverride: false,
        cellSize: 150,
        cellRandomness: 0.2,
        colorOverride: false,
        color: Triangulator.ColorFunction.RadialFromBottom,
        colorScaleInvert: false,
        colorPalette: ['#e7a71d', '#dc433e', '#9e084b', '#41062f'],
        colorRandomness: 0.15,
        quantizeSteps: 0,
        useGradient: true,
        gradient: Triangulator.GradientFunction.Random,
        gradientNegativeFactor: 0.03,
        gradientPositiveFactor: 0.03,
        strokeColor: false,
        strokeWidth: 1,
        strokeOnly: false,
        backgroundColor: '#000000',
      },
    };

    this.allColorFunctions = [...Object.entries(Triangulator.ColorFunction).map(i => i[1])];
    this.allGradientFunctions = [...Object.entries(Triangulator.GradientFunction).map(i => i[1])];

    /*
    this.imageColorOverride = (x, y) => {
      if (this.state.imageData.length > 0) {
        const x0 = x *
        return `rgb(${}, ${}, ${})`;
      } else {
        return '#000000';
      }
    };*/

    // Debounce input changes
    this.inputHandler = _.debounce(this.handleOptionChange, 150).bind(this);

    // Polyfill canvas.toBlob() used for saving images
    // Not natively implemented on iOS
    if (!HTMLCanvasElement.prototype.toBlob) {
      Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
        value: (callback, type, quality) => {
          const dataURL = this.toDataURL(type, quality).split(',')[1];
          setTimeout(() => {
            const binStr = atob(dataURL);
            const len = binStr.length;
            const arr = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
              arr[i] = binStr.charCodeAt(i);
            }
            callback(new Blob([arr], { type: type || 'image/png' }));
          });
        },
      });
    }
  }

  // Remove css styles from svg string before saving
  stripStyles(svgString) {
    return svgString.replace(/style=\\?".*?\\?"/g, '');
  }

  // Handle input changes from non-text inputs
  handleOptionChange(target) {
    const updatedState = { svgNeedsUpdating: true, options: this.state.options };

    if (target.id === 'color') {
      updatedState.options[target.id] = this.allColorFunctions[parseInt(target.value, 10)];
    } else if (target.id === 'gradient') {
      updatedState.options[target.id] = this.allGradientFunctions[parseInt(target.value, 10)];
    } else if (target.step === 1) updatedState.options[target.id] = parseInt(target.value, 10);
    else updatedState.options[target.id] = parseFloat(target.value);

    // Enforce safe width
    if (target.id === 'width' || target.id === 'height') {
      console.log('yes')
      updatedState.options[target.id] = Math.max(updatedState.options[target.id], 256);
    }

    // Enforce stroke
    if (!updatedState.options.strokeOnly) updatedState.options.strokeWidth = 1;

    this.setState(updatedState);
  }

  // Curried handler for toggle button inputs
  handleToggle(value) {
    return (event) => {
      console.log(event.target);
      const updatedState = { svgNeedsUpdating: true, options: this.state.options };
      updatedState.options[event.target.id] = value;
      this.setState(updatedState);
    };
  }

  // Curried handler for adding and removing color stops
  handleChangeColorStops(delta) {
    return () => {
      const newSize = this.state.options.colorPalette.length + delta;
      if (newSize > 0 && newSize <= 20) {
        const updatedState = { svgNeedsUpdating: true, options: this.state.options };
        updatedState.options.colorPalette = chroma.scale(this.state.options.colorPalette)
          .mode('lch').colors(newSize);
        this.setState(updatedState);
      }
    };
  }

  // Curried handler for color inputs
  handleColorChange(i) {
    return (color) => {
      console.log(color, i);
      const updatedState = { svgNeedsUpdating: true, options: this.state.options };
      updatedState.options.colorPalette[i] = color.hex;
      this.setState(updatedState);
    };
  }

  // Handler for BG color input
  handleBackgroundColorChange(color) {
    const updatedState = { svgNeedsUpdating: true, options: this.state.options };
    updatedState.options.backgroundColor = color.hex;
    this.setState(updatedState);
  }

  // Handler for image file upload
  handleFile(target) {
    const reader = new FileReader();
    reader.onload = (event) => {
      const sourceImage = new Image();
      sourceImage.onload = () => {
        // Draw image on canvas and extract data
        const canvas = document.getElementById('imageProcessingCanvas');
        canvas.width = sourceImage.width;
        canvas.height = sourceImage.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);
        this.setState({
          imageData: ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data,
          imageWidth: sourceImage.width,
          imageHeight: sourceImage.height,
        });
      };
      sourceImage.src = event.target.result;
    };
    reader.readAsDataURL(target.files[0]);
  }

  // Render SVG
  async generateSVG(element) {
    const { svgNeedsUpdating, options } = this.state;
    // TODO: sometimes element is null, iont know wtf is goin on here
    if (svgNeedsUpdating && element) {
      // If update flag is set, unset it before anything else
      console.time('1');
      await this.setState({ svgNeedsUpdating: false });
      await this.setState({ svgWidth: options.width, svgHeight: options.height });

      element.innerHTML = '';
      const svgString = Triangulator.generate({
        svgInput: element,
        forceSVGSize: false,
        ...options,
      });

      // Determine correct css sizing based on image and browser aspect ratios
      const windowAspect = document.getElementById('image-container').clientWidth
        / document.getElementById('root').clientHeight;
      const svgSizeCSS = { width: '', height: '' };
      if ((options.width / options.height) > windowAspect) svgSizeCSS.width = '100%';
      else svgSizeCSS.height = '100vh';

      await this.setState({ svgSizeCSS, svgString });
      console.timeEnd('1');
    }
  }

  // Render as image and download
  saveImage() {
    console.log(this.stripStyles(this.state.svgString));
    canvg('canvas', this.stripStyles(this.state.svgString));
    document.getElementById('canvas').toBlob((blob) => {
      saveAs(blob, `tri2-${new Date().toISOString()}.png`);
    });
  }

  // Download SVG data
  saveSVG() {
    const blob = new Blob([this.stripStyles(this.state.svgString)]);
    saveAs(blob, `tri2-${new Date().toISOString()}.svg`);
  }

  render() {
    return (
      <Container className='main h-100'>
        <Row className='h-100'>
          <Col xs='8' lg='9' className='image-container' id='image-container'>
            <svg
              id='image'
              style={this.state.svgSizeCSS}
              viewBox={`0 0 ${this.state.svgWidth} ${this.state.svgHeight}`}
              ref={this.generateSVG.bind(this)}
            />
          </Col>
          <Col xs='4' lg='3' className='controls-container'>
            <Form className='controls-form'>
              <h1 className='header-light header-stylized-text'>triangulator2</h1>
              <small>
                © 2019 <a href='https://jackw01.github.io'>jackw01</a>. <a href='https://github.com/jackw01/triangulator2-app'>View on Github</a>
              </small>
              <hr />
              <FormGroup className='spacer-top'>
                <Label className='input-group-label' for='seed'>Seed:</Label>
                <Input
                  id='seed'
                  className='w-100'
                  bsSize='sm'
                  type='number'
                  step='1'
                  defaultValue={this.state.options.seed}
                  onChange={e => this.inputHandler(e.target)}
                />
              </FormGroup>
              <FormGroup>
                <Label className='input-group-label' for='resolution'>Resolution:</Label>
                <Input
                  id='width'
                  bsSize='sm'
                  type='number'
                  step='1'
                  min='0'
                  max='8192'
                  defaultValue={this.state.options.width}
                  onChange={e => this.inputHandler(e.target)}
                />
                &nbsp;x&nbsp;
                <Input
                  id='height'
                  bsSize='sm'
                  type='number'
                  step='1'
                  min='0'
                  max='8192'
                  defaultValue={this.state.options.height}
                  onChange={e => this.inputHandler(e.target)}
                />
              </FormGroup>
              <FormGroup>
                <Label className='input-group-label' for='gridMode'>Grid Mode:</Label>
                <Input
                  id='gridMode'
                  bsSize='sm'
                  type='select'
                  defaultValue={this.state.options.gridMode}
                  onChange={e => this.handleOptionChange(e.target)}
                >
                  <option value='1'>Square</option>
                  <option value='2'>Triangle</option>
                  <option value='3'>Poisson</option>
                  <option value='4'>Override</option>
                </Input>
              </FormGroup>
              <FormGroup>
                <Label className='input-group-label' for='cellSize'>Cell Size:</Label>
                <input
                  id='cellSize'
                  type='range'
                  step='1'
                  min='80'
                  max='512'
                  defaultValue={this.state.options.cellSize}
                  onChange={e => this.inputHandler(e.target)}
                />
              </FormGroup>
              <FormGroup className={this.state.options.gridMode === 3 ? 'hidden' : ''}>
                <Label className='input-group-label' for='cellRandomness'>Cell Randomness:</Label>
                <input
                  id='cellRandomness'
                  type='range'
                  step='0.001'
                  min='0'
                  max='1'
                  defaultValue={this.state.options.cellRandomness}
                  onChange={e => this.inputHandler(e.target)}
                />
              </FormGroup>
              <hr />
              <FormGroup>
                <Label className='input-group-label' for='color'>Color Mode:</Label>
                <Input
                  id='color'
                  bsSize='sm'
                  type='select'
                  defaultValue={5}
                  onChange={e => this.handleOptionChange(e.target)}
                >
                  {this.allColorFunctions.map((f, i) => (
                    <option value={i}>{f.name}</option>
                  ))}
                </Input>
                <ButtonGroup size='sm' className='spacer-top'>
                  <Button
                    id='colorScaleInvert'
                    color='secondary'
                    onClick={this.handleToggle(false).bind(this)}
                    active={!this.state.options.colorScaleInvert}
                  >
                    Default
                  </Button>
                  <Button
                    id='colorScaleInvert'
                    color='secondary'
                    onClick={this.handleToggle(true).bind(this)}
                    active={this.state.options.colorScaleInvert}
                  >
                    Invert
                  </Button>
                </ButtonGroup>
              </FormGroup>
              <FormGroup>
                <Label className='input-group-label' for='colorRandomness'>Color Randomness:</Label>
                <input
                  id='colorRandomness'
                  type='range'
                  step='0.001'
                  min='0'
                  max='1'
                  defaultValue={this.state.options.colorRandomness}
                  onChange={e => this.inputHandler(e.target)}
                />
              </FormGroup>
              <FormGroup className='color-picker-container'>
                <Label className='input-group-label' for='colorPalette'>Color Palette:</Label>
                <Button
                  id='colorPaletteDecrease'
                  size='sm'
                  color='secondary'
                  onClick={this.handleChangeColorStops(-1).bind(this)}
                >
                  Remove Color
                </Button>
                &nbsp;
                <Button
                  id='colorPaletteIncrease'
                  size='sm'
                  color='secondary'
                  onClick={this.handleChangeColorStops(1).bind(this)}
                >
                  Add Color
                </Button>
                {this.state.options.colorPalette.map((hex, i) => (
                  <ChromePicker
                    color={hex}
                    disableAlpha
                    onChangeComplete={this.handleColorChange(i).bind(this)}
                  />
                ))}
              </FormGroup>
              <FormGroup>
                <Label className='input-group-label' for='quantizeSteps'>Color Quantization Levels:</Label>
                <input
                  id='quantizeSteps'
                  type='range'
                  step='1'
                  min='0'
                  max='10'
                  defaultValue={this.state.options.quantizeSteps}
                  onChange={e => this.inputHandler(e.target)}
                />
              </FormGroup>
              <hr />
              <FormGroup>
                <Label className='input-group-label' for='useGradient'>Generate Gradients:</Label>
                <ButtonGroup size='sm'>
                  <Button
                    id='useGradient'
                    color='secondary'
                    onClick={this.handleToggle(true).bind(this)}
                    active={this.state.options.useGradient}
                  >
                    On
                  </Button>
                  <Button
                    id='useGradient'
                    color='secondary'
                    onClick={this.handleToggle(false).bind(this)}
                    active={!this.state.options.useGradient}
                  >
                    Off
                  </Button>
                </ButtonGroup>
              </FormGroup>
              <FormGroup className={this.state.options.useGradient ? '' : 'hidden'}>
                <Label className='input-group-label' for='gradient'>Gradient Mode:</Label>
                <Input
                  id='gradient'
                  bsSize='sm'
                  type='select'
                  defaultValue={5}
                  onChange={e => this.handleOptionChange(e.target)}
                >
                  {this.allGradientFunctions.map((f, i) => (
                    <option value={i}>{f.name}</option>
                  ))}
                </Input>
              </FormGroup>
              <FormGroup className={this.state.options.useGradient ? '' : 'hidden'}>
                <Label className='input-group-label' for='gradientNegativeFactor'>Gradient Negative Factor:</Label>
                <input
                  id='gradientNegativeFactor'
                  type='range'
                  step='0.001'
                  min='0'
                  max='0.1'
                  defaultValue={this.state.options.gradientNegativeFactor}
                  onChange={e => this.inputHandler(e.target)}
                />
              </FormGroup>
              <FormGroup className={this.state.options.useGradient ? '' : 'hidden'}>
                <Label className='input-group-label' for='gradientPositiveFactor'>Gradient Positive Factor:</Label>
                <input
                  id='gradientPositiveFactor'
                  type='range'
                  step='0.001'
                  min='0'
                  max='0.1'
                  defaultValue={this.state.options.gradientPositiveFactor}
                  onChange={e => this.inputHandler(e.target)}
                />
              </FormGroup>
              <hr />
              <FormGroup>
                <Label className='input-group-label' for='strokeOnly'>Stroke Only Mode:</Label>
                <ButtonGroup size='sm'>
                  <Button
                    id='strokeOnly'
                    color='secondary'
                    onClick={this.handleToggle(true).bind(this)}
                    active={this.state.options.strokeOnly}
                  >
                    On
                  </Button>
                  <Button
                    id='strokeOnly'
                    color='secondary'
                    onClick={this.handleToggle(false).bind(this)}
                    active={!this.state.options.strokeOnly}
                  >
                    Off
                  </Button>
                </ButtonGroup>
              </FormGroup>
              <FormGroup className={this.state.options.strokeOnly ? '' : 'hidden'}>
                <Label className='input-group-label' for='strokeWidth'>Stroke Width:</Label>
                <input
                  id='strokeWidth'
                  type='range'
                  step='0.001'
                  min='0.1'
                  max='20'
                  defaultValue={this.state.options.strokeWidth}
                  onChange={e => this.inputHandler(e.target)}
                />
              </FormGroup>
              <FormGroup className={this.state.options.strokeOnly ? 'color-picker-container' : 'hidden'}>
                <Label className='input-group-label' for='backgroundColor'>Background Color:</Label>
                <ChromePicker
                  color={this.state.options.backgroundColor}
                  disableAlpha
                  onChangeComplete={this.handleBackgroundColorChange.bind(this)}
                />
              </FormGroup>
              <hr />
              <FormGroup>
                <Button
                  size='lg'
                  color='primary'
                  onClick={this.saveImage.bind(this)}
                >
                  Save Image
                </Button>
                <br />
                <Button
                  className='spacer-top'
                  size='lg'
                  color='secondary'
                  onClick={this.saveSVG.bind(this)}
                >
                  Save SVG
                </Button>
              </FormGroup>
            </Form>
          </Col>
        </Row>
        <canvas
          id='imageProcessingCanvas'
          className='hidden'
        />
        <canvas
          id='canvas'
          className='hidden'
          width={this.state.svgWidth}
          height={this.state.svgHeight}
        />
      </Container>
    );
  }
}

export default App;

/*<FormGroup className='spacer-top'>
  <Label className='input-group-label' for='image'>Image Input:</Label>
  <Input
    id='image'
    className='w-100'
    type='file'
    onChange={e => this.handleFile(e.target)}
  />
</FormGroup>*/
